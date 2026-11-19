import { describe, expect, it } from 'vitest';
import { offlineAssetPaths } from '../basemap/map-source';
import { API_URL, FakeOfflineNetwork, makeBasemap, MemoryOfflineStorage } from '../test-helpers';
import {
  ASSETS_ESTIMATED_BYTES,
  OFFLINE_MESSAGES,
  OfflineMapManager,
  SPACE_MARGIN_BYTES,
  spaceRequirement,
} from './offline-map';

const CHUNK = 4;

async function setup(size = 10) {
  const storage = new MemoryOfflineStorage();
  const network = new FakeOfflineNetwork();
  const basemap = await makeBasemap(size);
  network.publish(basemap.manifest.file, basemap.bytes);
  const manager = new OfflineMapManager({
    storage,
    network,
    apiUrl: API_URL,
    chunkBytes: CHUNK,
    now: () => new Date('2026-11-19T15:00:00Z'),
  });
  return { storage, network, manager, ...basemap };
}

/** Espera a que terminen las promesas encadenadas (reanudación automática). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('spaceRequirement', () => {
  const target = { size: 100 * 1024 * 1024, assetsCommit: 'abc' };

  it('pide el archivo, los glifos y sprites y deja margen', () => {
    const r = spaceRequirement({
      target,
      partialBytes: 0,
      assetsCommit: null,
      availableBytes: 1024 ** 3,
    });
    expect(r.requiredBytes).toBe(target.size + ASSETS_ESTIMATED_BYTES);
    expect(r.enough).toBe(true);
  });

  it('descuenta lo ya descargado y los recursos del mismo commit', () => {
    const r = spaceRequirement({
      target,
      partialBytes: 40 * 1024 * 1024,
      assetsCommit: 'abc',
      availableBytes: 60 * 1024 * 1024 + SPACE_MARGIN_BYTES,
    });
    expect(r.requiredBytes).toBe(60 * 1024 * 1024);
    expect(r.enough).toBe(true);
  });

  it('no alcanza sin el margen de seguridad', () => {
    const r = spaceRequirement({
      target,
      partialBytes: 0,
      assetsCommit: 'abc',
      availableBytes: target.size + SPACE_MARGIN_BYTES - 1,
    });
    expect(r.enough).toBe(false);
  });
});

describe('OfflineMapManager', () => {
  it('descarga completa: bloques con Range, glifos y sprites, SHA-256 y copia lista', async () => {
    const { storage, network, manager, manifest, bytes } = await setup(10);
    await manager.init();
    manager.setLatest(manifest);
    expect(manager.getSnapshot().current).toBeNull();

    await manager.start();

    expect(network.rangeRequests.map((r) => [r.offset, r.length])).toEqual([
      [0, 4],
      [4, 4],
      [8, 2],
    ]);
    expect(network.rangeRequests[0]!.url).toBe(`${API_URL}/tiles/panter-20261118.pmtiles`);
    expect(storage.files.get(manifest.file)).toEqual(bytes);
    expect(storage.files.has(`${manifest.file}.part`)).toBe(false);
    expect([...storage.assets.keys()]).toEqual(offlineAssetPaths());
    const snapshot = manager.getSnapshot();
    expect(snapshot.download).toEqual({ status: 'idle' });
    expect(snapshot.current).toMatchObject({
      file: manifest.file,
      build: '20261118',
      size: 10,
      completedAt: '2026-11-19T15:00:00.000Z',
    });
    expect(snapshot.updateAvailable).toBe(false);
    expect(storage.record).toMatchObject({ pending: null, assetsCommit: 'abc1234' });
  });

  it('informa el progreso de cada bloque', async () => {
    const { manager, manifest } = await setup(10);
    await manager.init();
    manager.setLatest(manifest);
    const seen: number[] = [];
    manager.subscribe(() => {
      const d = manager.getSnapshot().download;
      if (d.status === 'downloading' && d.phase === 'tiles') seen.push(d.receivedBytes);
    });
    await manager.start();
    expect(seen).toEqual([0, 4, 8, 10]);
  });

  it('descarga cortada: conserva lo bajado y reanuda sola al volver la señal', async () => {
    const { storage, network, manager, manifest, bytes } = await setup(10);
    await manager.init();
    manager.setLatest(manifest);
    network.cutAfterChunks = 1;

    await manager.start();

    expect(manager.getSnapshot().download).toEqual({
      status: 'interrupted',
      build: '20261118',
      receivedBytes: 4,
      totalBytes: 10,
      reason: 'network',
      message: OFFLINE_MESSAGES.network,
    });
    expect(storage.partialSize(manifest.file)).toBe(4);
    expect(storage.record?.pending?.file).toBe(manifest.file);

    network.rangeRequests = [];
    network.setOnline(true);
    await flush();
    await flush();

    expect(network.rangeRequests[0]!.offset).toBe(4);
    expect(storage.files.get(manifest.file)).toEqual(bytes);
    expect(manager.getSnapshot().current?.build).toBe('20261118');
  });

  it('reanuda tras cerrar la app desde el tamaño del .part guardado', async () => {
    const first = await setup(10);
    await first.manager.init();
    first.manager.setLatest(first.manifest);
    first.network.cutAfterChunks = 2;
    await first.manager.start();
    expect(first.storage.partialSize(first.manifest.file)).toBe(8);

    // "Reinicio": nuevo manager con el mismo almacenamiento.
    const network = new FakeOfflineNetwork();
    network.publish(first.manifest.file, first.bytes);
    const manager = new OfflineMapManager({
      storage: first.storage,
      network,
      apiUrl: API_URL,
      chunkBytes: CHUNK,
    });
    await manager.init();
    expect(manager.getSnapshot().download).toMatchObject({
      status: 'interrupted',
      reason: 'paused',
      receivedBytes: 8,
      totalBytes: 10,
    });
    manager.setLatest(first.manifest);
    await manager.start();
    expect(network.rangeRequests).toEqual([
      { url: `${API_URL}/tiles/${first.manifest.file}`, offset: 8, length: 2 },
    ]);
    expect(first.storage.files.get(first.manifest.file)).toEqual(first.bytes);
  });

  it('pausa a pedido y reanuda manualmente', async () => {
    const { network, manager, manifest, storage, bytes } = await setup(10);
    await manager.init();
    manager.setLatest(manifest);
    const original = network.fetchRange.bind(network);
    network.fetchRange = async (url, offset, length) => {
      if (offset === 4) manager.pause();
      const chunk = await original(url, offset, length);
      if (offset === 4) throw new DOMException('Aborted', 'AbortError');
      return chunk;
    };
    await manager.start();
    expect(manager.getSnapshot().download).toMatchObject({
      status: 'interrupted',
      reason: 'paused',
      receivedBytes: 4,
    });
    network.fetchRange = original;
    await manager.start();
    expect(storage.files.get(manifest.file)).toEqual(bytes);
  });

  it('build nuevo: avisa que hay actualización, descarga la nueva y borra la anterior', async () => {
    const { storage, network, manager, manifest } = await setup(10);
    await manager.init();
    manager.setLatest(manifest);
    await manager.start();

    const next = await makeBasemap(6, '20261202', 'abc1234');
    network.publish(next.manifest.file, next.bytes);
    network.rangeRequests = [];
    manager.setLatest(next.manifest);
    expect(manager.getSnapshot()).toMatchObject({
      updateAvailable: true,
      latest: { build: '20261202', size: 6 },
    });

    await manager.start();

    expect(manager.getSnapshot().current?.build).toBe('20261202');
    expect(manager.getSnapshot().updateAvailable).toBe(false);
    expect(storage.files.has(manifest.file)).toBe(false);
    expect(storage.files.get(next.manifest.file)).toEqual(next.bytes);
    // Mismo commit de basemaps-assets: no vuelve a bajar glifos ni sprites.
    expect(network.rangeRequests.every((r) => r.url.endsWith('.pmtiles'))).toBe(true);
  });

  it('build nuevo con una descarga a medias del anterior: la descarta', async () => {
    const { storage, network, manager, manifest } = await setup(10);
    await manager.init();
    manager.setLatest(manifest);
    network.cutAfterChunks = 1;
    await manager.start();
    expect(storage.partialSize(manifest.file)).toBe(4);

    const next = await makeBasemap(6, '20261202');
    network.publish(next.manifest.file, next.bytes);
    manager.setLatest(next.manifest);

    expect(storage.partialSize(manifest.file)).toBe(0);
    expect(storage.record?.pending).toBeNull();
    expect(manager.getSnapshot().download).toEqual({ status: 'idle' });

    network.setOnline(true);
    await flush();
    await manager.start();
    expect(manager.getSnapshot().current?.build).toBe('20261202');
  });

  it('sin espacio: no empieza y dice cuánto hace falta', async () => {
    const { storage, network, manager, manifest } = await setup(10);
    storage.available = 10 + ASSETS_ESTIMATED_BYTES + SPACE_MARGIN_BYTES - 1;
    await manager.init();
    manager.setLatest(manifest);
    expect(manager.requirement()).toMatchObject({
      requiredBytes: 10 + ASSETS_ESTIMATED_BYTES,
      enough: false,
    });

    await manager.start();

    expect(network.rangeRequests).toHaveLength(0);
    expect(manager.getSnapshot().download).toEqual({
      status: 'no-space',
      build: '20261118',
      requiredBytes: 10 + ASSETS_ESTIMATED_BYTES,
      availableBytes: storage.available,
    });
  });

  it('se queda sin espacio a mitad de la descarga', async () => {
    const { storage, manager, manifest } = await setup(10);
    await manager.init();
    manager.setLatest(manifest);
    // Otra app llenó el teléfono después de revisar el espacio.
    storage.appendPartial = async () => {
      storage.available = 5;
      throw new Error('ENOSPC');
    };
    await manager.start();
    expect(manager.getSnapshot().download).toMatchObject({ status: 'no-space', requiredBytes: 10 });
  });

  it('SHA-256 distinto: descarta el archivo y pide descargar de nuevo', async () => {
    const { storage, manager, manifest } = await setup(10);
    await manager.init();
    manager.setLatest({ ...manifest, sha256: 'b'.repeat(64) });
    await manager.start();
    expect(manager.getSnapshot().download).toEqual({
      status: 'failed',
      build: '20261118',
      message: OFFLINE_MESSAGES.corrupted,
    });
    expect(manager.getSnapshot().current).toBeNull();
    expect(storage.files.has(manifest.file)).toBe(false);
  });

  it('el servidor devuelve otro tamaño: no mezcla archivos', async () => {
    const { storage, network, manager, manifest } = await setup(10);
    network.publish(manifest.file, new Uint8Array(12));
    await manager.init();
    manager.setLatest(manifest);
    await manager.start();
    expect(manager.getSnapshot().download).toMatchObject({ status: 'failed' });
    expect(storage.partialSize(manifest.file)).toBe(0);
  });

  it('borrar elimina la copia, los recursos y el registro', async () => {
    const { storage, manager, manifest } = await setup(10);
    await manager.init();
    manager.setLatest(manifest);
    await manager.start();
    await manager.remove();
    expect(storage.files.size).toBe(0);
    expect(storage.assets.size).toBe(0);
    expect(manager.getSnapshot().current).toBeNull();
    expect(storage.record).toMatchObject({ current: null, pending: null });
  });
});
