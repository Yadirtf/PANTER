import { describe, expect, it } from 'vitest';
import type { TileObjectInfo, TileStore } from '../../../src/modules/tiles/application/ports';
import { makeServeTile } from '../../../src/modules/tiles/application/serve-tile';
import type { ByteRange } from '../../../src/modules/tiles/domain/http-range';
import {
  createCachedTileStore,
  type ResponseCache,
} from '../../../src/modules/tiles/infrastructure/cached-tile-store';

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

class MemoryTileStore implements TileStore {
  readonly objects = new Map<string, Uint8Array>();
  heads = 0;
  reads: { key: string; range: ByteRange }[] = [];

  async head(key: string): Promise<TileObjectInfo | null> {
    this.heads++;
    const data = this.objects.get(key);
    return data ? { size: data.length, etag: `"etag-${key}-${data.length}"` } : null;
  }

  async read(key: string, _info: TileObjectInfo, range: ByteRange) {
    this.reads.push({ key, range });
    const data = this.objects.get(key);
    if (!data) return null;
    return new Response(data.slice(range.offset, range.offset + range.length)).body;
  }
}

/** Caché en memoria con la semántica mínima de la Cache API (clave = URL). */
class MemoryCache implements ResponseCache {
  readonly entries = new Map<string, { body: ArrayBuffer; headers: Headers }>();
  failPut = false;

  async match(request: Request) {
    const entry = this.entries.get(request.url);
    return entry ? new Response(entry.body.slice(0), { headers: entry.headers }) : undefined;
  }

  async put(request: Request, response: Response) {
    if (this.failPut) throw new Error('caché llena');
    this.entries.set(request.url, {
      body: await response.arrayBuffer(),
      headers: new Headers(response.headers),
    });
  }
}

async function text(body: ReadableStream | null): Promise<Uint8Array> {
  return new Uint8Array(await new Response(body).arrayBuffer());
}

describe('makeServeTile', () => {
  const store = new MemoryTileStore();
  store.objects.set('panter-20261117.pmtiles', bytes(1000));
  const serve = makeServeTile({ store });

  it('archivo completo sin Range', async () => {
    const result = await serve({ path: 'panter-20261117.pmtiles' });
    expect(result).toMatchObject({ kind: 'content', range: null, info: { size: 1000 } });
    if (result.kind !== 'content') throw new Error();
    expect(await text(result.body)).toEqual(bytes(1000));
  });

  it('rango parcial', async () => {
    const result = await serve({ path: 'panter-20261117.pmtiles', range: 'bytes=10-19' });
    expect(result).toMatchObject({ kind: 'content', range: { offset: 10, length: 10 } });
    if (result.kind !== 'content') throw new Error();
    expect(await text(result.body)).toEqual(bytes(1000).slice(10, 20));
  });

  it('HEAD no lee el cuerpo', async () => {
    const before = store.reads.length;
    const result = await serve({
      path: 'panter-20261117.pmtiles',
      range: 'bytes=0-9',
      headOnly: true,
    });
    expect(result).toMatchObject({ kind: 'content', body: null, range: { offset: 0, length: 10 } });
    expect(store.reads.length).toBe(before);
  });

  it('If-None-Match con el ETag vigente: no modificado, sin leer', async () => {
    const before = store.reads.length;
    const result = await serve({
      path: 'panter-20261117.pmtiles',
      ifNoneMatch: '"etag-panter-20261117.pmtiles-1000"',
      range: 'bytes=0-9',
    });
    expect(result.kind).toBe('not-modified');
    expect(store.reads.length).toBe(before);
  });

  it('rango fuera del archivo', async () => {
    const result = await serve({ path: 'panter-20261117.pmtiles', range: 'bytes=1000-' });
    expect(result).toMatchObject({ kind: 'range-not-satisfiable', info: { size: 1000 } });
  });

  it('inexistente o fuera de la lista blanca: no encontrado sin consultar el almacén', async () => {
    expect(await serve({ path: 'panter-20260101.pmtiles' })).toEqual({ kind: 'not-found' });
    const heads = store.heads;
    expect(await serve({ path: '../panter-documents/x.pdf' })).toEqual({ kind: 'not-found' });
    expect(store.heads).toBe(heads);
  });

  it('rango de glifos no subido: PBF vacío', async () => {
    const result = await serve({ path: 'fonts/Noto Sans Regular/19968-20223.pbf' });
    expect(result).toMatchObject({ kind: 'empty-glyphs' });
  });

  it('el objeto desaparece entre head y read: no encontrado', async () => {
    const flaky: TileStore = {
      head: async () => ({ size: 10, etag: '"x"' }),
      read: async () => null,
    };
    expect(await makeServeTile({ store: flaky })({ path: 'basemap.json' })).toEqual({
      kind: 'not-found',
    });
  });
});

describe('createCachedTileStore', () => {
  function setup() {
    const inner = new MemoryTileStore();
    inner.objects.set('panter-20261117.pmtiles', bytes(500));
    const cache = new MemoryCache();
    const pending: Promise<unknown>[] = [];
    const store = createCachedTileStore(inner, {
      cache,
      waitUntil: (p) => pending.push(p),
      ttlFor: () => 60,
    });
    const flush = () => Promise.all(pending.splice(0));
    return { inner, cache, store, flush };
  }

  it('la segunda lectura del mismo rango no toca R2', async () => {
    const { inner, cache, store, flush } = setup();
    const info = await store.head('panter-20261117.pmtiles');
    expect(info).toEqual({ size: 500, etag: '"etag-panter-20261117.pmtiles-500"' });
    const range = { offset: 100, length: 50 };
    expect(await text(await store.read('panter-20261117.pmtiles', info!, range))).toEqual(
      bytes(500).slice(100, 150),
    );
    await flush();
    expect(inner.reads).toHaveLength(1);
    expect(cache.entries.size).toBe(2);

    expect(await store.head('panter-20261117.pmtiles')).toEqual(info);
    expect(await text(await store.read('panter-20261117.pmtiles', info!, range))).toEqual(
      bytes(500).slice(100, 150),
    );
    expect(inner.heads).toBe(1);
    expect(inner.reads).toHaveLength(1);
  });

  it('guarda las copias con el max-age de la política', async () => {
    const { cache, store, flush } = setup();
    const info = await store.head('panter-20261117.pmtiles');
    await store.read('panter-20261117.pmtiles', info!, { offset: 0, length: 500 });
    await flush();
    for (const entry of cache.entries.values()) {
      expect(entry.headers.get('cache-control')).toBe('public, max-age=60');
    }
  });

  it('un ETag nuevo usa otra entrada (no mezcla versiones)', async () => {
    const { inner, store, flush } = setup();
    const range = { offset: 0, length: 10 };
    await text(await store.read('panter-20261117.pmtiles', { size: 500, etag: '"v1"' }, range));
    await flush();
    await text(await store.read('panter-20261117.pmtiles', { size: 500, etag: '"v2"' }, range));
    expect(inner.reads).toHaveLength(2);
  });

  it('no guarda los inexistentes y sobrevive a un fallo de la caché', async () => {
    const { inner, cache, store, flush } = setup();
    expect(await store.head('basemap.json')).toBeNull();
    await flush();
    expect(cache.entries.size).toBe(0);

    cache.failPut = true;
    const info = await store.head('panter-20261117.pmtiles');
    expect(
      await text(await store.read('panter-20261117.pmtiles', info!, { offset: 0, length: 5 })),
    ).toEqual(bytes(5));
    await expect(flush()).resolves.toBeDefined();
    expect(inner.reads).toHaveLength(1);
  });

  it('una lectura que ya no existe devuelve null sin guardar', async () => {
    const { cache, store, flush } = setup();
    expect(
      await store.read('basemap.json', { size: 3, etag: '"z"' }, { offset: 0, length: 3 }),
    ).toBeNull();
    await flush();
    expect(cache.entries.size).toBe(0);
  });
});
