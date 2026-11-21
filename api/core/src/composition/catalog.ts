import type { Env } from '../env';
import {
  makeCreateArea,
  makeGetArea,
  makeImportAreas,
  makeListAreas,
  makeLocateArea,
  makeUpdateArea,
} from '../modules/catalog/application/areas';
import { makeListCatalogHistory } from '../modules/catalog/application/history';
import type {
  AreaRepository,
  CatalogChangeRepository,
  OnCatalogChange,
} from '../modules/catalog/application/ports';
import type { AreaFactories } from '../modules/catalog/http/area-routes';
import { createDrizzleAreaRepository } from '../modules/catalog/infrastructure/drizzle-area-repository';
import { createDrizzleCatalogChangeRepository } from '../modules/catalog/infrastructure/drizzle-catalog-change-repository';
import {
  createCachedAreaReader,
  isolateCatalogCache,
  type CatalogCache,
} from '../modules/catalog/infrastructure/memory-catalog-cache';
import { buildDb } from './db';

/** Adaptadores reemplazables en pruebas (repositorios en memoria, caché propia, reloj). */
export interface CatalogOverrides {
  areas?: (env: Env) => AreaRepository;
  changes?: (env: Env) => CatalogChangeRepository;
  cache?: CatalogCache;
  clock?: () => number;
  onChange?: OnCatalogChange;
}

export const defaultAreas = (env: Env) => createDrizzleAreaRepository(buildDb(env));
export const defaultCatalogChanges = (env: Env) =>
  createDrizzleCatalogChangeRepository(buildDb(env));

/**
 * Raíz de composición de barrios y veredas (HU-308). Las lecturas públicas pasan por la caché
 * del isolate (60 s); cualquier escritura la vacía.
 */
export function buildAreaFactories(overrides: CatalogOverrides = {}): AreaFactories {
  const areas = overrides.areas ?? defaultAreas;
  const changes = overrides.changes ?? defaultCatalogChanges;
  const cache = overrides.cache ?? isolateCatalogCache;
  const onChange = overrides.onChange ?? (() => cache.invalidate());
  const reader = (env: Env) =>
    createCachedAreaReader({ areas: areas(env), cache, now: overrides.clock });
  return {
    list: (env) => makeListAreas({ areas: reader(env) }),
    get: (env) => makeGetArea({ areas: reader(env) }),
    locate: (env) => makeLocateArea({ areas: reader(env) }),
    create: (env) => makeCreateArea({ areas: areas(env), onChange }),
    update: (env) => makeUpdateArea({ areas: areas(env), onChange }),
    importAreas: (env) => makeImportAreas({ areas: areas(env), onChange }),
    history: (env) => makeListCatalogHistory({ changes: changes(env), entity: 'AREA' }),
  };
}
