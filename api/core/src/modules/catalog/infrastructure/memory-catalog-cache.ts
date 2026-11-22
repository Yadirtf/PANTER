import type { LatLng } from '@panter/contracts';
import type { AreaReader, PlaceReader } from '../application/ports';

/** Vigencia de la caché del catálogo en memoria del isolate (HU-308). */
export const CATALOG_CACHE_TTL_MS = 60_000;
/** Máximo de consultas guardadas (las más viejas salen primero). */
export const CATALOG_CACHE_MAX_ENTRIES = 1000;
/** `locate` redondea a 5 decimales (≈ 1 m): dos pines en el mismo metro comparten respuesta. */
export const LOCATE_CACHE_DECIMALS = 5;

interface Entry {
  at: number;
  value: unknown;
}

/**
 * Caché de lecturas públicas del catálogo (barrios, veredas y lugares) en memoria del isolate.
 * Un isolate de Workers atiende muchas peticiones seguidas: así la app no va a Neon cada vez que
 * abre el buscador o ubica un pin. Cualquier edición desde la administración la vacía en el
 * mismo isolate; los demás ven el cambio en máximo 60 s. Guarda valores ya resueltos (no
 * promesas): en Workers una petición no debe esperar la E/S de otra. Los errores no se guardan.
 */
export class CatalogCache {
  private readonly entries = new Map<string, Entry>();
  /** Sube en cada invalidación: una lectura que empezó antes de una edición no se guarda. */
  private generation = 0;

  constructor(
    private readonly ttlMs: number = CATALOG_CACHE_TTL_MS,
    private readonly maxEntries: number = CATALOG_CACHE_MAX_ENTRIES,
  ) {}

  invalidate(): void {
    this.generation++;
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  async get<T>(key: string, now: number, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && now - hit.at < this.ttlMs) return hit.value as T;
    const generation = this.generation;
    const value = await load();
    if (generation !== this.generation) return value;
    this.entries.delete(key);
    this.entries.set(key, { at: now, value });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    return value;
  }
}

/** Caché compartida por las peticiones de este isolate. */
export const isolateCatalogCache = new CatalogCache();

const rounded = (p: LatLng) => {
  const f = 10 ** LOCATE_CACHE_DECIMALS;
  return `${Math.round(p.lat * f) || 0},${Math.round(p.lng * f) || 0}`;
};

/** Lecturas de barrios y veredas con la caché del isolate. */
export function createCachedAreaReader(deps: {
  areas: AreaReader;
  cache?: CatalogCache;
  now?: () => number;
}): AreaReader {
  const cache = deps.cache ?? isolateCatalogCache;
  const now = deps.now ?? Date.now;
  return {
    list: (filter) =>
      cache.get(
        `areas:list:${filter.kind ?? '*'}:${filter.includeInactive ? 1 : 0}:${filter.search ?? ''}`,
        now(),
        () => deps.areas.list(filter),
      ),
    get: (id) => cache.get(`areas:get:${id}`, now(), () => deps.areas.get(id)),
    getMany: (ids) =>
      cache.get(`areas:many:${[...ids].sort().join(',')}`, now(), () => deps.areas.getMany(ids)),
    locate: (point) =>
      cache.get(`areas:locate:${rounded(point)}`, now(), () => deps.areas.locate(point)),
  };
}

/**
 * Lecturas públicas de lugares con la caché del isolate (HU-310). `get` no pasa por la caché:
 * lo usa la administración justo antes y después de editar.
 */
export function createCachedPlaceReader(deps: {
  places: PlaceReader;
  cache?: CatalogCache;
  now?: () => number;
}): PlaceReader {
  const cache = deps.cache ?? isolateCatalogCache;
  const now = deps.now ?? Date.now;
  return {
    list: (f) =>
      cache.get(
        `places:list:${f.category ?? '*'}:${f.includeInactive ? 1 : 0}:${f.limit}:${f.search ?? ''}`,
        now(),
        () => deps.places.list(f),
      ),
    nearby: (f) =>
      cache.get(`places:nearby:${rounded(f.point)}:${f.radiusMeters}:${f.limit}`, now(), () =>
        deps.places.nearby(f),
      ),
    get: (id) => deps.places.get(id),
  };
}
