// Catálogo con copia en el teléfono (HU-311): la última respuesta de GET /areas, GET /places y de
// cada GET /areas/:id consultado se guarda en el sistema de archivos. Sin señal (o si la API
// falla) se usa esa copia, así el pasajero puede elegir barrio o lugar en zona rural.
import {
  type Area,
  AreaSchema,
  type AreaSummary,
  AreasResponseSchema,
  type Place,
  PlacesResponseSchema,
} from '@panter/contracts';
import type { Schema } from '../../shared/api/http-client';
import type { CatalogApi } from './api/catalog-api';

/** Almacenamiento de texto por clave (archivos en el teléfono; memoria en las pruebas). */
export interface CatalogStorage {
  read(key: string): Promise<string | null>;
  write(key: string, text: string): Promise<void>;
}

export const CATALOG_KEYS = {
  AREAS: 'areas',
  PLACES: 'places',
  /** Polígonos de los barrios consultados, por id. */
  AREA_DETAILS: 'area-details',
} as const;

export interface CatalogResult<T> {
  items: T;
  /** network: respuesta recién llegada; cache: última copia guardada (sin señal o API caída). */
  source: 'network' | 'cache';
  /** Cuándo se guardó la copia (ISO). */
  savedAt: string;
}

interface Envelope {
  savedAt: string;
  data: unknown;
}

async function readEnvelope<T>(
  storage: CatalogStorage,
  key: string,
  schema: Schema<T>,
): Promise<{ savedAt: string; data: T } | null> {
  try {
    const text = await storage.read(key);
    if (!text) return null;
    const envelope = JSON.parse(text) as Partial<Envelope>;
    if (typeof envelope.savedAt !== 'string') return null;
    const parsed = schema.safeParse(envelope.data);
    return parsed.success ? { savedAt: envelope.savedAt, data: parsed.data } : null;
  } catch {
    // Copia dañada o ilegible: como si no hubiera.
    return null;
  }
}

async function writeEnvelope(storage: CatalogStorage, key: string, data: unknown, savedAt: string) {
  try {
    await storage.write(key, JSON.stringify({ savedAt, data } satisfies Envelope));
  } catch {
    // Sin espacio o sin permiso: la respuesta igual sirve, solo no queda para después.
  }
}

/**
 * Pide a la red y guarda la respuesta; si la red falla, devuelve la última copia válida. Sin copia,
 * propaga el error original (NETWORK_ERROR, etc.).
 */
export async function fetchWithCache<T>(options: {
  key: string;
  storage: CatalogStorage;
  schema: Schema<T>;
  fetch: () => Promise<T>;
  now?: () => Date;
}): Promise<CatalogResult<T>> {
  const { key, storage, schema, fetch, now = () => new Date() } = options;
  try {
    const data = await fetch();
    const savedAt = now().toISOString();
    await writeEnvelope(storage, key, data, savedAt);
    return { items: data, source: 'network', savedAt };
  } catch (error) {
    const cached = await readEnvelope(storage, key, schema);
    if (!cached) throw error;
    return { items: cached.data, source: 'cache', savedAt: cached.savedAt };
  }
}

const AreaDetailsSchema: Schema<Record<string, Area>> = {
  safeParse(data) {
    if (typeof data !== 'object' || data === null) return { success: false, error: 'not object' };
    const out: Record<string, Area> = {};
    for (const [id, value] of Object.entries(data)) {
      const parsed = AreaSchema.safeParse(value);
      if (parsed.success) out[id] = parsed.data;
    }
    return { success: true, data: out };
  },
};

export interface CatalogRepository {
  /** Barrios y veredas (una consulta por sesión de la app; `refresh` vuelve a pedir). */
  areas(options?: { refresh?: boolean }): Promise<CatalogResult<AreaSummary[]>>;
  places(options?: { refresh?: boolean }): Promise<CatalogResult<Place[]>>;
  /** Barrio con polígono; queda guardado para usarlo sin señal. */
  area(id: string): Promise<Area>;
  /** Barrios con polígono ya guardados en el teléfono (respaldo sin señal de la descripción). */
  knownAreas(): Promise<Area[]>;
  /** Lugares de la última respuesta (red o copia), sin consultar la red. */
  knownPlaces(): Promise<Place[]>;
}

export function createCatalogRepository(deps: {
  api: CatalogApi;
  storage: CatalogStorage;
  now?: () => Date;
}): CatalogRepository {
  const { api, storage, now } = deps;
  let areas: Promise<CatalogResult<AreaSummary[]>> | null = null;
  let places: Promise<CatalogResult<Place[]>> | null = null;
  let details: Promise<Record<string, Area>> | null = null;

  const loadDetails = () =>
    (details ??= readEnvelope(storage, CATALOG_KEYS.AREA_DETAILS, AreaDetailsSchema).then(
      (cached) => cached?.data ?? {},
    ));

  /** Una lista fallida no queda memorizada: el siguiente intento vuelve a pedir. */
  function memo<T>(promise: Promise<T>, clear: () => void): Promise<T> {
    promise.catch(clear);
    return promise;
  }

  const repository: CatalogRepository = {
    areas({ refresh = false } = {}) {
      if (refresh || !areas) {
        areas = memo(
          fetchWithCache({
            key: CATALOG_KEYS.AREAS,
            storage,
            schema: AreasResponseSchema,
            fetch: () => api.listAreas(),
            now,
          }).then((result) => ({ ...result, items: result.items.items })),
          () => (areas = null),
        );
      }
      return areas;
    },
    places({ refresh = false } = {}) {
      if (refresh || !places) {
        places = memo(
          fetchWithCache({
            key: CATALOG_KEYS.PLACES,
            storage,
            schema: PlacesResponseSchema,
            fetch: () => api.listPlaces(),
            now,
          }).then((result) => ({ ...result, items: result.items.items })),
          () => (places = null),
        );
      }
      return places;
    },
    async area(id) {
      const known = await loadDetails();
      try {
        const area = await api.getArea(id);
        const next = { ...known, [id]: area };
        details = Promise.resolve(next);
        await writeEnvelope(
          storage,
          CATALOG_KEYS.AREA_DETAILS,
          next,
          (now?.() ?? new Date()).toISOString(),
        );
        return area;
      } catch (error) {
        const cached = known[id];
        if (cached) return cached;
        throw error;
      }
    },
    async knownAreas() {
      return Object.values(await loadDetails());
    },
    async knownPlaces() {
      if (places) {
        try {
          return (await places).items;
        } catch {
          // Cae a la copia guardada.
        }
      }
      const cached = await readEnvelope(storage, CATALOG_KEYS.PLACES, PlacesResponseSchema);
      return cached?.data.items ?? [];
    },
  };
  return repository;
}
