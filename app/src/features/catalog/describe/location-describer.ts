// "Barrio X · cerca de Y" para el origen y el destino (HU-311), con GET /areas/locate y
// GET /places/nearby y `describeLocation` de contracts.
// - Caché por coordenada redondeada (DESCRIBE_DECIMALS ≈ 11 m): mover el pin unos metros no
//   vuelve a consultar.
// - Debounce: mientras se arrastra el pin solo se consulta el último punto, tras una pausa.
// - Sin señal: se describe con la copia del catálogo (lugar más cercano y barrios con polígono
//   guardados). Ese resultado no se guarda en la caché, para preferir la API cuando vuelva la red.
import {
  type AreaSummary,
  describeLocation,
  haversineMeters,
  type LatLng,
  type Place,
} from '@panter/contracts';
import { type CatalogApi, NEARBY_RADIUS_METERS } from '../api/catalog-api';
import type { CatalogRepository } from '../catalog-repository';
import { isInsideArea } from '../selection';

/** 4 decimales ≈ 11 m (como la caché de rutas). */
export const DESCRIBE_DECIMALS = 4;
/** Pausa tras el último cambio del punto antes de consultar. */
export const DESCRIBE_DEBOUNCE_MS = 600;
/** Descripciones guardadas en memoria como máximo (las más viejas salen primero). */
export const DESCRIBE_CACHE_SIZE = 200;

export interface LocationDescription {
  /** "Barrio Centro · cerca de Parque principal", o `null` si no hay barrio ni lugar cercano. */
  text: string | null;
  area: Pick<AreaSummary, 'id' | 'name' | 'kind'> | null;
  nearby: Pick<Place, 'id' | 'name'> | null;
  source: 'network' | 'offline';
}

export function describeKey(point: LatLng, decimals = DESCRIBE_DECIMALS): string {
  return `${point.lat.toFixed(decimals)},${point.lng.toFixed(decimals)}`;
}

function build(
  area: LocationDescription['area'],
  nearby: LocationDescription['nearby'],
  source: LocationDescription['source'],
): LocationDescription {
  return { text: describeLocation(area, nearby), area, nearby, source };
}

export interface LocationDescriber {
  /** Descripción del punto (de la caché si ya se consultó uno a menos de ~11 m). */
  describe(point: LatLng): Promise<LocationDescription>;
  /** Descripción ya conocida, sin consultar. */
  peek(point: LatLng): LocationDescription | null;
}

export function createLocationDescriber(deps: {
  api: Pick<CatalogApi, 'locateArea' | 'nearbyPlaces'>;
  catalog: Pick<CatalogRepository, 'knownAreas' | 'knownPlaces'>;
  decimals?: number;
}): LocationDescriber {
  const { api, catalog, decimals = DESCRIBE_DECIMALS } = deps;
  const cache = new Map<string, LocationDescription>();
  const inFlight = new Map<string, Promise<LocationDescription>>();

  function remember(key: string, value: LocationDescription) {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > DESCRIBE_CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }

  async function offline(point: LatLng): Promise<LocationDescription> {
    const [areas, places] = await Promise.all([
      catalog.knownAreas().catch(() => []),
      catalog.knownPlaces().catch(() => []),
    ]);
    const area = areas.find((a) => a.active && isInsideArea(point, a)) ?? null;
    let nearby: Place | null = null;
    let best = NEARBY_RADIUS_METERS;
    for (const place of places) {
      if (!place.active) continue;
      const meters = haversineMeters(point, place.location);
      if (meters <= best) {
        best = meters;
        nearby = place;
      }
    }
    return build(area, nearby, 'offline');
  }

  async function online(point: LatLng): Promise<LocationDescription> {
    const [located, near] = await Promise.all([api.locateArea(point), api.nearbyPlaces(point, 1)]);
    return build(located.area, near.items[0] ?? null, 'network');
  }

  return {
    peek: (point) => cache.get(describeKey(point, decimals)) ?? null,
    describe(point) {
      const key = describeKey(point, decimals);
      const hit = cache.get(key);
      if (hit) return Promise.resolve(hit);
      const pending = inFlight.get(key);
      if (pending) return pending;
      const promise = online(point)
        .then((value) => {
          remember(key, value);
          return value;
        })
        .catch(() => offline(point))
        .finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },
  };
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Pide la descripción del último punto: si ya está en la caché responde enseguida; si no, espera
 * `delayMs` sin cambios antes de consultar. Respuestas de puntos reemplazados se descartan.
 */
export function createDescriptionRequester(
  describer: LocationDescriber,
  onResult: (point: LatLng, description: LocationDescription) => void,
  { delayMs = DESCRIBE_DEBOUNCE_MS, timers = defaultTimers } = {},
) {
  let timer: unknown = null;
  let generation = 0;

  return {
    request(point: LatLng | null) {
      generation += 1;
      const current = generation;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      if (!point) return;
      const known = describer.peek(point);
      if (known) {
        onResult(point, known);
        return;
      }
      timer = timers.setTimeout(() => {
        timer = null;
        void describer.describe(point).then((description) => {
          if (current === generation) onResult(point, description);
        });
      }, delayMs);
    },
    cancel() {
      generation += 1;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}
