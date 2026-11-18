import type { TileObjectInfo, TileStore } from '../application/ports';

/** Subconjunto de la Cache API de Workers que se usa (caches.default). */
export interface ResponseCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface CachedTileStoreOptions {
  cache: ResponseCache;
  /** `ctx.waitUntil`: la escritura en caché termina después de responder. */
  waitUntil: (promise: Promise<unknown>) => void;
  /** Segundos que vale cada copia, según la política del archivo (domain/tile-file.ts). */
  ttlFor: (key: string) => number;
}

/** Las lecturas mayores no se guardan (límite de la Cache API: 512 MB por objeto). */
const MAX_CACHED_BYTES = 100 * 1024 * 1024;
/** Host ficticio de las claves: nunca se resuelve, solo identifica la entrada. */
const CACHE_ORIGIN = 'https://tiles-cache.panter.internal';

const SIZE_HEADER = 'x-panter-size';
const ETAG_HEADER = 'x-panter-etag';

function metaKey(key: string): Request {
  return new Request(`${CACHE_ORIGIN}/meta/${encodeURIComponent(key)}`);
}

function rangeKey(key: string, info: TileObjectInfo, offset: number, length: number): Request {
  // El ETag va en la clave: si el objeto cambia, sus rangos viejos nunca se reutilizan.
  const etag = encodeURIComponent(info.etag);
  return new Request(
    `${CACHE_ORIGIN}/bytes/${encodeURIComponent(key)}?etag=${etag}&o=${offset}&l=${length}`,
  );
}

/**
 * Decorador de un TileStore con la Cache API del Worker: guarda los metadatos (`head`) y cada
 * rango leído, para que las teselas más pedidas no lean R2 en cada petición. Las copias son
 * respuestas 200 internas (la Cache API no guarda 206); el caso de uso arma la respuesta real.
 *
 * En `*.workers.dev` la Cache API no persiste (las operaciones no fallan, pero no guardan): la
 * caché tiene efecto con un dominio propio. El navegador y la app cachean igual por
 * Cache-Control y ETag.
 */
export function createCachedTileStore(
  inner: TileStore,
  options: CachedTileStoreOptions,
): TileStore {
  const { cache, waitUntil, ttlFor } = options;
  const cacheControl = (key: string) => `public, max-age=${ttlFor(key)}`;

  const store = (request: Request, response: Response) => {
    waitUntil(
      cache.put(request, response).catch((err: unknown) => {
        console.warn({
          message: 'No se pudo guardar en la caché del mapa base',
          url: request.url,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }),
    );
  };

  return {
    async head(key) {
      const request = metaKey(key);
      const hit = await cache.match(request);
      if (hit) {
        const size = Number(hit.headers.get(SIZE_HEADER));
        const etag = hit.headers.get(ETAG_HEADER);
        if (Number.isFinite(size) && etag) return { size, etag };
      }
      const info = await inner.head(key);
      // Los "no existe" no se guardan: el archivo puede subirse en cualquier momento.
      if (info) {
        store(
          request,
          new Response(null, {
            headers: {
              [SIZE_HEADER]: String(info.size),
              [ETAG_HEADER]: info.etag,
              'cache-control': cacheControl(key),
            },
          }),
        );
      }
      return info;
    },

    async read(key, info, range) {
      const request = rangeKey(key, info, range.offset, range.length);
      const hit = await cache.match(request);
      if (hit?.body) return hit.body;

      const body = await inner.read(key, info, range);
      if (!body || range.length > MAX_CACHED_BYTES) return body;
      const [forClient, forCache] = body.tee();
      store(
        request,
        new Response(forCache, {
          headers: {
            'content-length': String(range.length),
            'content-type': 'application/octet-stream',
            'cache-control': cacheControl(key),
          },
        }),
      );
      return forClient;
    },
  };
}
