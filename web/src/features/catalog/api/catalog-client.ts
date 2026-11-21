import {
  AreaImportResultSchema,
  AreaSchema,
  CatalogHistoryResponseSchema,
  PlaceSchema,
  type Area,
  type AreaCreateBody,
  type AreaImportBody,
  type AreaImportResult,
  type AreaUpdateBody,
  type CatalogHistoryResponse,
  type Place,
  type PlaceCreateBody,
  type PlaceUpdateBody,
} from '@panter/contracts';
import { z } from 'zod';
import { createHttpClient, type HttpClient } from '@/shared/api/http-client';

/** Rutas BFF del catálogo (mismo origen que la web; sin tokens en el navegador). */
export const CatalogBffRoutes = {
  AREAS: '/api/admin/areas',
  AREA_DETAILS: '/api/admin/areas/details',
  AREA_IMPORT: '/api/admin/areas/import',
  area: (id: string) => `/api/admin/areas/${encodeURIComponent(id)}`,
  areaHistory: (id: string) => `/api/admin/areas/${encodeURIComponent(id)}/history`,
  PLACES: '/api/admin/places',
  place: (id: string) => `/api/admin/places/${encodeURIComponent(id)}`,
  placeHistory: (id: string) => `/api/admin/places/${encodeURIComponent(id)}/history`,
} as const;

export interface CatalogClientConfig {
  /** Origen de la web; por defecto `window.location.origin`. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

function client(config: CatalogClientConfig): HttpClient {
  return createHttpClient({
    baseUrl: config.baseUrl ?? window.location.origin,
    fetch: config.fetch,
  });
}

const AreaDetailsSchema = z.object({ items: z.array(AreaSchema), missing: z.array(z.string()) });

/** Polígonos de un lote de barrios (máximo AREA_DETAILS_MAX_IDS por llamada). */
export function fetchAreaDetails(ids: readonly string[], config: CatalogClientConfig = {}) {
  return client(config).get(CatalogBffRoutes.AREA_DETAILS, {
    schema: AreaDetailsSchema,
    query: { ids: ids.join(',') },
  });
}

/** Barrio guardado, si la API lo devolvió con el formato de AreaSchema. */
function asArea(value: unknown): Area | null {
  const parsed = AreaSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function createArea(
  body: AreaCreateBody,
  config: CatalogClientConfig = {},
): Promise<Area | null> {
  return asArea(await client(config).post(CatalogBffRoutes.AREAS, { schema: z.unknown(), body }));
}

export async function updateArea(
  id: string,
  body: AreaUpdateBody,
  config: CatalogClientConfig = {},
): Promise<Area | null> {
  return asArea(
    await client(config).patch(CatalogBffRoutes.area(id), { schema: z.unknown(), body }),
  );
}

export function importAreas(
  body: AreaImportBody,
  config: CatalogClientConfig = {},
): Promise<AreaImportResult> {
  return client(config).post(CatalogBffRoutes.AREA_IMPORT, {
    schema: AreaImportResultSchema,
    body,
  });
}

export function fetchAreaHistory(
  id: string,
  cursor?: string,
  config: CatalogClientConfig = {},
): Promise<CatalogHistoryResponse> {
  return client(config).get(CatalogBffRoutes.areaHistory(id), {
    schema: CatalogHistoryResponseSchema,
    query: { cursor },
  });
}

/** Lugar guardado con el barrio que calculó la API, si la respuesta tiene el formato de PlaceSchema. */
function asPlace(value: unknown): Place | null {
  const parsed = PlaceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function createPlace(
  body: PlaceCreateBody,
  config: CatalogClientConfig = {},
): Promise<Place | null> {
  return asPlace(await client(config).post(CatalogBffRoutes.PLACES, { schema: z.unknown(), body }));
}

export async function updatePlace(
  id: string,
  body: PlaceUpdateBody,
  config: CatalogClientConfig = {},
): Promise<Place | null> {
  return asPlace(
    await client(config).patch(CatalogBffRoutes.place(id), { schema: z.unknown(), body }),
  );
}

export function fetchPlaceHistory(
  id: string,
  cursor?: string,
  config: CatalogClientConfig = {},
): Promise<CatalogHistoryResponse> {
  return client(config).get(CatalogBffRoutes.placeHistory(id), {
    schema: CatalogHistoryResponseSchema,
    query: { cursor },
  });
}
