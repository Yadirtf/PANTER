import {
  ROUTE_CACHE_DECIMALS,
  type FareRule,
  type LatLng,
  type VehicleType,
} from '@panter/contracts';
import type {
  FareCatalog,
  FareRuleRepository,
  GeofenceHit,
  GeofenceRepository,
} from '../application/ports';

/** Vigencia de la caché de tarifas en memoria del isolate (HU-402). */
export const FARE_CACHE_TTL_MS = 60_000;
/** Máximo de consultas de geocercas guardadas (las más viejas salen primero). */
export const FARE_COVERAGE_MAX_ENTRIES = 500;

interface Entry<T> {
  at: number;
  value: T;
}

/**
 * Caché de reglas y geocercas en memoria del isolate. Un isolate de Workers atiende muchas
 * peticiones seguidas, así que evita ir a Neon en cada estimado. Se invalida al editar desde la
 * administración en el mismo isolate; los demás isolates ven el cambio en máximo 60 s.
 */
export class FareCache {
  private rules: Entry<Map<VehicleType, FareRule>> | null = null;
  private readonly coverage = new Map<string, Entry<GeofenceHit[]>>();

  constructor(
    private readonly ttlMs: number = FARE_CACHE_TTL_MS,
    private readonly maxEntries: number = FARE_COVERAGE_MAX_ENTRIES,
  ) {}

  invalidate(): void {
    this.rules = null;
    this.coverage.clear();
  }

  async getRules(now: number, load: () => Promise<FareRule[]>) {
    if (this.rules && now - this.rules.at < this.ttlMs) return this.rules.value;
    const value = new Map((await load()).map((r) => [r.vehicleType, r]));
    this.rules = { at: now, value };
    return value;
  }

  async getCoverage(key: string, now: number, load: () => Promise<GeofenceHit[]>) {
    const hit = this.coverage.get(key);
    if (hit && now - hit.at < this.ttlMs) return hit.value;
    const value = await load();
    this.coverage.delete(key);
    this.coverage.set(key, { at: now, value });
    while (this.coverage.size > this.maxEntries) {
      this.coverage.delete(this.coverage.keys().next().value!);
    }
    return value;
  }
}

/** Caché compartida por las peticiones de este isolate. */
export const isolateFareCache = new FareCache();

const point = (p: LatLng) => {
  const f = 10 ** ROUTE_CACHE_DECIMALS;
  return `${Math.round(p.lat * f) || 0},${Math.round(p.lng * f) || 0}`;
};

export function createCachedFareCatalog(deps: {
  rules: FareRuleRepository;
  geofences: GeofenceRepository;
  cache?: FareCache;
  now?: () => number;
}): FareCatalog {
  const cache = deps.cache ?? isolateFareCache;
  const now = deps.now ?? Date.now;
  return {
    async rule(vehicleType) {
      const rules = await cache.getRules(now(), () => deps.rules.list());
      return rules.get(vehicleType) ?? null;
    },
    covering(input) {
      const key = `${input.vehicleType}|${point(input.origin)}|${point(input.destination)}`;
      return cache.getCoverage(key, now(), () => deps.geofences.findCovering(input));
    },
  };
}
