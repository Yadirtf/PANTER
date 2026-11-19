import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/index';
import { buildTilesFactories } from '../src/composition/tiles';

// Contenido determinista: el byte i vale i % 251 (así un rango se distingue de otro).
const SIZE = 40_000;
const DATA = Uint8Array.from({ length: SIZE }, (_, i) => i % 251);
const PMTILES = 'panter-20261117.pmtiles';
const URL_BASE = 'https://api.test/tiles';

const get = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  exports.default.fetch(`${URL_BASE}/${path}`, { method, headers });

beforeAll(async () => {
  await env.TILES!.put(PMTILES, DATA);
  await env.TILES!.put('basemap.json', JSON.stringify({ file: PMTILES }));
  await env.TILES!.put('fonts/Noto Sans Regular/0-255.pbf', new Uint8Array([1, 2, 3]));
});

describe('GET /tiles/:file (R2 de Miniflare)', () => {
  it('sirve el archivo completo con ETag, Accept-Ranges, caché inmutable y CORS abierto', async () => {
    const res = await get(PMTILES, { Origin: 'https://cualquier-sitio.example' });
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('etag')).toMatch(/^".+"$/);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-length')).toBe(String(SIZE));
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-expose-headers')).toContain('Content-Range');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(DATA);
  });

  it('responde 206 con Content-Range a la cabecera PMTiles (bytes=0-16383)', async () => {
    const res = await get(PMTILES, { Range: 'bytes=0-16383' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-16383/${SIZE}`);
    expect(res.headers.get('content-length')).toBe('16384');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(DATA.slice(0, 16384));
  });

  it('rango intermedio, abierto y sufijo', async () => {
    const middle = await get(PMTILES, { Range: 'bytes=20000-20009' });
    expect(middle.status).toBe(206);
    expect(new Uint8Array(await middle.arrayBuffer())).toEqual(DATA.slice(20000, 20010));

    const open = await get(PMTILES, { Range: 'bytes=39990-' });
    expect(open.headers.get('content-range')).toBe(`bytes 39990-39999/${SIZE}`);
    expect(new Uint8Array(await open.arrayBuffer())).toEqual(DATA.slice(39990));

    const suffix = await get(PMTILES, { Range: 'bytes=-5' });
    expect(suffix.headers.get('content-range')).toBe(`bytes 39995-39999/${SIZE}`);
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(DATA.slice(39995));
  });

  it('repite el mismo rango igual (copia de la Cache API)', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await get(PMTILES, { Range: 'bytes=100-199' });
      expect(res.status).toBe(206);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(DATA.slice(100, 200));
    }
  });

  it('rango fuera del archivo: 416 con Content-Range bytes */tamaño', async () => {
    const res = await get(PMTILES, { Range: `bytes=${SIZE}-${SIZE + 100}` });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${SIZE}`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toMatchObject({
      error: { code: 'RANGE_NOT_SATISFIABLE', details: { size: SIZE } },
    });
  });

  it('Range mal formado o con varios rangos: se ignora y responde 200', async () => {
    const res = await get(PMTILES, { Range: 'bytes=0-1,5-6' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(SIZE));
    await res.body?.cancel();
  });

  it('If-None-Match con el ETag vigente: 304 sin cuerpo', async () => {
    const first = await get(PMTILES, { Range: 'bytes=0-0' });
    const etag = first.headers.get('etag')!;
    await first.body?.cancel();

    const res = await get(PMTILES, { 'If-None-Match': etag, Range: 'bytes=0-16383' });
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe(etag);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(await res.text()).toBe('');

    const stale = await get(PMTILES, { 'If-None-Match': '"otro"', Range: 'bytes=0-0' });
    expect(stale.status).toBe(206);
    await stale.body?.cancel();
  });

  it('archivo inexistente: 404 con el error uniforme', async () => {
    const res = await get('panter-20200101.pmtiles');
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('nombres fuera de la lista blanca: 404 (sin path traversal)', async () => {
    await env.DOCUMENTS.put('privado.txt', 'secreto');
    await env.TILES!.put('notas.txt', 'no publicado');
    for (const path of ['notas.txt', '..%2Fprivado.txt', 'fonts/..%2F..%2Fnotas.txt', '%2e%2e/x']) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      await res.body?.cancel();
    }
  });

  it('HEAD devuelve cabeceras sin cuerpo', async () => {
    const res = await get(PMTILES, { Range: 'bytes=0-99' }, 'HEAD');
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-99/${SIZE}`);
    expect(res.headers.get('content-length')).toBe('100');
    expect(await res.text()).toBe('');
  });

  it('preflight CORS abierto solo para lectura', async () => {
    const res = await get(
      PMTILES,
      {
        Origin: 'https://otra-web.example',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'range',
      },
      'OPTIONS',
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toContain('Range');
  });

  it('no acepta escrituras', async () => {
    const res = await exports.default.fetch(`${URL_BASE}/${PMTILES}`, { method: 'PUT', body: 'x' });
    expect(res.status).toBe(404);
  });

  it('el manifiesto basemap.json tiene caché corta', async () => {
    const res = await get('basemap.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await res.json()).toEqual({ file: PMTILES });
  });

  it('glifos: sirve los subidos y un PBF vacío para rangos no subidos', async () => {
    const res = await get('fonts/Noto%20Sans%20Regular/0-255.pbf');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-protobuf');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const missing = await get('fonts/Noto%20Sans%20Regular/19968-20223.pbf');
    expect(missing.status).toBe(200);
    expect(missing.headers.get('content-length')).toBe('0');
    expect((await missing.arrayBuffer()).byteLength).toBe(0);
  });

  it('las rutas existentes conservan su CORS restringido', async () => {
    const res = await exports.default.fetch('https://api.test/health', {
      headers: { Origin: 'https://otra-web.example' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('Cache API delante de R2', () => {
  it('un rango ya servido no vuelve a leer R2', async () => {
    const key = 'panter-20261118.pmtiles';
    await env.TILES!.put(key, DATA);
    const first = await get(key, { Range: 'bytes=500-599' });
    expect(first.status).toBe(206);
    await first.arrayBuffer();

    // La copia se guarda con waitUntil: se espera a que exista antes de espiar R2.
    const cacheKey = (suffix: string) =>
      new Request(`https://tiles-cache.panter.internal/${suffix}`);
    await vi.waitFor(async () => {
      expect(await caches.default.match(cacheKey(`meta/${key}`))).toBeDefined();
    });

    const bucket = env.TILES!;
    const head = vi.spyOn(bucket, 'head');
    const getSpy = vi.spyOn(bucket, 'get');
    try {
      await vi.waitFor(async () => {
        const again = await createApp().request(
          `/tiles/${key}`,
          { headers: { Range: 'bytes=500-599' } },
          env,
        );
        expect(again.status).toBe(206);
        expect(new Uint8Array(await again.arrayBuffer())).toEqual(DATA.slice(500, 600));
        expect(getSpy).not.toHaveBeenCalled();
      });
      expect(head).not.toHaveBeenCalled();
    } finally {
      head.mockRestore();
      getSpy.mockRestore();
    }
  });
});

describe('sin bucket TILES', () => {
  it('/tiles responde 503 con un mensaje claro y /health sigue funcionando', async () => {
    const app = createApp({ tiles: buildTilesFactories() });
    const noTiles = { ...env, TILES: undefined };
    const res = await app.request(`/tiles/${PMTILES}`, {}, noTiles);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: { code: 'TILES_UNAVAILABLE', message: expect.stringContaining('mapa base') },
    });

    const health = await app.request('/health', {}, noTiles);
    expect(health.status).toBe(200);
  });
});
