import { makeServeTile } from '../modules/tiles/application/serve-tile';
import type { TileStore } from '../modules/tiles/application/ports';
import { maxAgeSeconds, resolveTileFile } from '../modules/tiles/domain/tile-file';
import type { TilesFactories } from '../modules/tiles/http/routes';
import { AppError } from '../shared/errors/app-error';
import {
  createCachedTileStore,
  type ResponseCache,
} from '../modules/tiles/infrastructure/cached-tile-store';
import { createR2TileStore } from '../modules/tiles/infrastructure/r2-tile-store';

/** La caché por defecto del Worker; `null` fuera de workerd (pruebas en Node). */
function defaultCache(): ResponseCache | null {
  return typeof caches === 'undefined' ? null : caches.default;
}

function ttlFor(key: string): number {
  const file = resolveTileFile(key);
  return file ? maxAgeSeconds(file.policy) : 0;
}

/** Raíz de composición del módulo tiles (HU-301). `cache` se reemplaza en las pruebas. */
export function buildTilesFactories(
  overrides: { cache?: () => ResponseCache | null } = {},
): TilesFactories {
  const getCache = overrides.cache ?? defaultCache;
  return {
    serveTile: (env, waitUntil) => {
      if (!env.TILES) {
        throw new AppError(
          'TILES_UNAVAILABLE',
          'El mapa base no está disponible: falta el bucket R2 del mapa (binding TILES).',
          { status: 503 },
        );
      }
      const r2: TileStore = createR2TileStore(env.TILES);
      const cache = getCache();
      const store = cache ? createCachedTileStore(r2, { cache, waitUntil, ttlFor }) : r2;
      return makeServeTile({ store });
    },
  };
}
