// Descarga del mapa para usar sin señal (HU-303, §6.1): el conductor guarda el .pmtiles vigente,
// los glifos y los sprites en el teléfono. TypeScript puro sobre puertos (offline-types.ts).
//
// - El .pmtiles se baja por bloques con `Range` (GET /tiles/<archivo> responde 206) y se agrega
//   a `<archivo>.part`. El tamaño del .part es el punto de reanudación: si se corta la señal o
//   se cierra la app, la descarga sigue desde ahí.
// - Antes de empezar se compara el espacio libre con lo que falta (`size` de basemap.json).
// - Al terminar se verifica el SHA-256 del manifiesto y se reemplaza la copia anterior; mientras
//   se descarga una actualización, la copia anterior sigue en uso.
// - Si basemap.json pasa a otro build, la descarga a medias del build viejo se descarta.
import type { BasemapManifest } from '@panter/map-style';
import { offlineAssetPaths, tileAssetUrl } from '../basemap/map-source';
import {
  type DownloadState,
  OfflineFetchError,
  type OfflineMapNetwork,
  type OfflineMapRecord,
  type OfflineMapSnapshot,
  type OfflineMapStorage,
  type PendingDownload,
} from './offline-types';

/** Tamaño de cada petición con Range. */
export const CHUNK_BYTES = 2 * 1024 * 1024;
/** Glifos (21 rangos) y sprites (8 archivos) pesan menos de 3 MB. */
export const ASSETS_ESTIMATED_BYTES = 3 * 1024 * 1024;
/** Margen libre que se deja en el teléfono además de lo que se descarga. */
export const SPACE_MARGIN_BYTES = 20 * 1024 * 1024;

export const OFFLINE_MESSAGES = {
  network: 'Se perdió la señal. La descarga sigue sola cuando vuelva la conexión.',
  paused: 'La descarga quedó en pausa. Puedes reanudarla cuando quieras.',
  server: 'El servidor no respondió. Intenta de nuevo en unos minutos.',
  corrupted: 'El archivo descargado no coincide con el publicado. Descárgalo de nuevo.',
  storage: 'No pudimos guardar el mapa en el teléfono. Revisa el espacio libre e intenta de nuevo.',
} as const;

const EMPTY_RECORD: OfflineMapRecord = {
  version: 1,
  current: null,
  pending: null,
  assetsCommit: null,
};

export interface SpaceRequirement {
  /** Bytes que faltan por descargar (archivo restante + glifos y sprites si faltan). */
  requiredBytes: number;
  availableBytes: number;
  /** Alcanza con el margen de seguridad. */
  enough: boolean;
}

/** Espacio que pide la descarga de `target`, descontando lo que ya está en el .part. */
export function spaceRequirement(input: {
  target: Pick<PendingDownload, 'size' | 'assetsCommit'>;
  partialBytes: number;
  assetsCommit: string | null;
  availableBytes: number;
}): SpaceRequirement {
  const remaining = Math.max(0, input.target.size - input.partialBytes);
  const assets = input.assetsCommit === input.target.assetsCommit ? 0 : ASSETS_ESTIMATED_BYTES;
  const requiredBytes = remaining + assets;
  return {
    requiredBytes,
    availableBytes: input.availableBytes,
    enough: input.availableBytes >= requiredBytes + SPACE_MARGIN_BYTES,
  };
}

function toPending(manifest: BasemapManifest): PendingDownload {
  return {
    file: manifest.file,
    build: manifest.build,
    size: manifest.size,
    sha256: manifest.sha256.toLowerCase(),
    assetsCommit: manifest.assetsCommit ?? '',
  };
}

export interface OfflineMapManagerDeps {
  storage: OfflineMapStorage;
  network: OfflineMapNetwork;
  apiUrl: string;
  now?: () => Date;
  chunkBytes?: number;
}

export class OfflineMapManager {
  private readonly deps: Required<Omit<OfflineMapManagerDeps, 'now'>> & { now: () => Date };
  private record: OfflineMapRecord = EMPTY_RECORD;
  private latestManifest: BasemapManifest | null = null;
  private snapshot: OfflineMapSnapshot = {
    loaded: false,
    current: null,
    latest: null,
    updateAvailable: false,
    download: { status: 'idle' },
  };
  private readonly listeners = new Set<() => void>();
  private initPromise: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private unsubscribeNetwork: (() => void) | null = null;

  constructor(deps: OfflineMapManagerDeps) {
    this.deps = {
      chunkBytes: CHUNK_BYTES,
      now: () => new Date(),
      ...deps,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): OfflineMapSnapshot => this.snapshot;

  /** Lee la copia guardada y escucha la red para reanudar sola una descarga cortada. */
  init(): Promise<void> {
    this.initPromise ??= this.load();
    return this.initPromise;
  }

  private async load(): Promise<void> {
    const record = await this.deps.storage.loadRecord().catch(() => null);
    this.record = record ?? EMPTY_RECORD;
    let download: DownloadState = { status: 'idle' };
    const { pending } = this.record;
    if (pending) {
      download = {
        status: 'interrupted',
        build: pending.build,
        receivedBytes: Math.min(this.deps.storage.partialSize(pending.file), pending.size),
        totalBytes: pending.size,
        reason: 'paused',
        message: OFFLINE_MESSAGES.paused,
      };
    }
    this.unsubscribeNetwork = this.deps.network.subscribe((online) => {
      const state = this.snapshot.download;
      if (online && state.status === 'interrupted' && state.reason === 'network') {
        void this.start();
      }
    });
    this.update({ loaded: true, download });
    if (this.latestManifest) this.setLatest(this.latestManifest);
  }

  /** Manifiesto vigente de basemap.json: detecta builds nuevos y descarta descargas viejas. */
  setLatest(manifest: BasemapManifest): void {
    this.latestManifest = manifest;
    if (!this.snapshot.loaded) {
      this.update({ latest: { file: manifest.file, build: manifest.build, size: manifest.size } });
      return;
    }
    const { pending } = this.record;
    if (!this.running && pending && pending.file !== manifest.file) {
      // Build nuevo: lo descargado a medias del anterior ya no sirve.
      this.deps.storage.deletePartial(pending.file);
      this.record = { ...this.record, pending: null };
      void this.saveRecord();
      this.update({ download: { status: 'idle' } });
    }
    this.update({ latest: { file: manifest.file, build: manifest.build, size: manifest.size } });
  }

  /** Espacio que pide descargar (o actualizar a) el manifiesto vigente. */
  requirement(): SpaceRequirement | null {
    const target = this.target();
    if (!target) return null;
    const partialBytes =
      this.record.pending?.file === target.file ? this.deps.storage.partialSize(target.file) : 0;
    return spaceRequirement({
      target,
      partialBytes,
      assetsCommit: this.record.assetsCommit,
      availableBytes: this.deps.storage.availableBytes(),
    });
  }

  /** Lo que hay que descargar: el manifiesto vigente o, sin él, la descarga pendiente. */
  private target(): PendingDownload | null {
    if (this.latestManifest) return toPending(this.latestManifest);
    return this.record.pending;
  }

  /** Descarga (o reanuda, o actualiza a) el mapa vigente. */
  async start(): Promise<void> {
    await this.init();
    if (this.running) return this.running;
    const target = this.target();
    if (!target || this.record.current?.file === target.file) return;
    this.running = this.run(target).finally(() => {
      this.running = null;
      this.abort = null;
    });
    return this.running;
  }

  /** Pausa la descarga en curso; lo descargado se conserva. */
  pause(): void {
    this.abort?.abort();
  }

  /** Borra la copia y cualquier descarga a medias. */
  async remove(): Promise<void> {
    this.pause();
    await this.running?.catch(() => undefined);
    const { current, pending } = this.record;
    if (pending) this.deps.storage.deletePartial(pending.file);
    if (current) this.deps.storage.deleteBasemap(current.file);
    this.deps.storage.deleteAssets();
    this.record = EMPTY_RECORD;
    await this.saveRecord();
    this.update({ download: { status: 'idle' } });
  }

  dispose(): void {
    this.pause();
    this.unsubscribeNetwork?.();
    this.unsubscribeNetwork = null;
  }

  private async run(target: PendingDownload): Promise<void> {
    const { storage, network, apiUrl, chunkBytes } = this.deps;
    const previous = this.record.pending;
    if (previous && previous.file !== target.file) storage.deletePartial(previous.file);

    let offset = storage.partialSize(target.file);
    if (previous?.file !== target.file || offset > target.size) {
      if (offset > 0) storage.deletePartial(target.file);
      offset = 0;
    }

    const space = spaceRequirement({
      target,
      partialBytes: offset,
      assetsCommit: this.record.assetsCommit,
      availableBytes: storage.availableBytes(),
    });
    if (!space.enough) {
      this.update({
        download: {
          status: 'no-space',
          build: target.build,
          requiredBytes: space.requiredBytes,
          availableBytes: space.availableBytes,
        },
      });
      return;
    }

    this.record = { ...this.record, pending: target };
    await this.saveRecord();
    const abort = new AbortController();
    this.abort = abort;
    const progress = (phase: 'tiles' | 'assets' | 'verifying') =>
      this.update({
        download: {
          status: 'downloading',
          build: target.build,
          phase,
          receivedBytes: offset,
          totalBytes: target.size,
        },
      });

    try {
      progress('tiles');
      const url = tileAssetUrl(apiUrl, target.file);
      while (offset < target.size) {
        const length = Math.min(chunkBytes, target.size - offset);
        const chunk = await network.fetchRange(url, offset, length, abort.signal);
        if (chunk.total !== target.size || chunk.bytes.length !== length) {
          throw new OfflineFetchError('mismatch', 'El archivo del servidor cambió de tamaño');
        }
        await storage.appendPartial(target.file, offset, chunk.bytes);
        offset += length;
        progress('tiles');
      }

      if (this.record.assetsCommit !== target.assetsCommit) {
        progress('assets');
        for (const path of offlineAssetPaths()) {
          const bytes = await network.fetchBytes(tileAssetUrl(apiUrl, path), abort.signal);
          await storage.writeAsset(path, bytes);
        }
        this.record = { ...this.record, assetsCommit: target.assetsCommit };
        await this.saveRecord();
      }

      progress('verifying');
      storage.completePartial(target.file);
      const digest = (await storage.digest(target.file)).toLowerCase();
      if (digest !== target.sha256) {
        storage.deleteBasemap(target.file);
        this.record = { ...this.record, pending: null };
        await this.saveRecord();
        this.update({
          download: { status: 'failed', build: target.build, message: OFFLINE_MESSAGES.corrupted },
        });
        return;
      }

      const old = this.record.current;
      this.record = {
        ...this.record,
        pending: null,
        current: {
          file: target.file,
          build: target.build,
          size: target.size,
          sha256: target.sha256,
          assetsCommit: target.assetsCommit,
          completedAt: this.deps.now().toISOString(),
        },
      };
      await this.saveRecord();
      if (old && old.file !== target.file) storage.deleteBasemap(old.file);
      this.update({ download: { status: 'idle' } });
    } catch (error) {
      this.fail(target, offset, error, abort.signal.aborted);
    }
  }

  private fail(target: PendingDownload, offset: number, error: unknown, aborted: boolean): void {
    const interrupted = (reason: 'network' | 'paused' | 'server', message: string) =>
      this.update({
        download: {
          status: 'interrupted',
          build: target.build,
          receivedBytes: offset,
          totalBytes: target.size,
          reason,
          message,
        },
      });

    if (aborted) return interrupted('paused', OFFLINE_MESSAGES.paused);
    if (error instanceof OfflineFetchError) {
      if (error.kind === 'network') return interrupted('network', OFFLINE_MESSAGES.network);
      if (error.kind === 'server') return interrupted('server', OFFLINE_MESSAGES.server);
      this.deps.storage.deletePartial(target.file);
      this.record = { ...this.record, pending: null };
      void this.saveRecord();
      this.update({
        download: { status: 'failed', build: target.build, message: OFFLINE_MESSAGES.corrupted },
      });
      return;
    }
    // Error al escribir: casi siempre falta de espacio.
    const available = this.deps.storage.availableBytes();
    const remaining = target.size - offset;
    if (available < remaining + SPACE_MARGIN_BYTES) {
      this.update({
        download: {
          status: 'no-space',
          build: target.build,
          requiredBytes: remaining,
          availableBytes: available,
        },
      });
      return;
    }
    interrupted('server', OFFLINE_MESSAGES.storage);
  }

  private async saveRecord(): Promise<void> {
    try {
      await this.deps.storage.saveRecord(this.record);
    } catch {
      // Sin registro, la próxima apertura no reanuda; el archivo ya descargado sigue en disco.
    }
  }

  private update(patch: Partial<OfflineMapSnapshot>): void {
    const next = { ...this.snapshot, ...patch, current: this.record.current };
    const latest = next.latest;
    next.updateAvailable =
      next.current !== null && latest !== null && latest.file !== next.current.file;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
