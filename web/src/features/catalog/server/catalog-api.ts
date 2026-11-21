import {
  adminAreaPath,
  adminPlacePath,
  AreaImportResultSchema,
  AreaRoutes,
  AreaSchema,
  AreasResponseSchema,
  areaPath,
  CatalogHistoryResponseSchema,
  PlaceRoutes,
  PlacesResponseSchema,
  type Area,
  type AreaCreateBody,
  type AreaImportBody,
  type AreaImportResult,
  type AreaKind,
  type AreasResponse,
  type AreaUpdateBody,
  type CatalogHistoryResponse,
  type PlaceCategory,
  type PlaceCreateBody,
  type PlacesResponse,
  type PlaceUpdateBody,
} from '@panter/contracts';
import { z } from 'zod';
import { createHttpClient } from '@/shared/api/http-client';

export interface CatalogApiConfig {
  /** URL base de panter-api. */
  apiUrl: string;
  /** Inyectable para pruebas; por defecto el `fetch` global. */
  fetch?: typeof fetch;
}

export interface AreasListQuery {
  q?: string;
  kind?: AreaKind;
  includeInactive?: boolean;
}

export interface PlacesListQuery {
  q?: string;
  category?: PlaceCategory;
  includeInactive?: boolean;
  limit?: number;
}

/** Máximo de lugares por página de GET /places (PlacesQuerySchema). */
export const PLACES_PAGE_LIMIT = 100;

/**
 * Llamadas de servidor a servidor al catálogo geográfico (E15) con el access token de la cookie
 * como Bearer: barrios y veredas (HU-308/HU-309) y lugares (HU-310). Las respuestas de crear y
 * editar se devuelven tal cual (el navegador las lee con AreaSchema o PlaceSchema).
 */
export interface CatalogApi {
  areas(accessToken: string, query?: AreasListQuery): Promise<AreasResponse>;
  area(accessToken: string, id: string): Promise<Area>;
  createArea(accessToken: string, body: AreaCreateBody): Promise<unknown>;
  updateArea(accessToken: string, id: string, body: AreaUpdateBody): Promise<unknown>;
  importAreas(accessToken: string, body: AreaImportBody): Promise<AreaImportResult>;
  areaHistory(accessToken: string, id: string, cursor?: string): Promise<CatalogHistoryResponse>;
  /** GET /places; con `accessToken` null es la lectura pública (sin Bearer). */
  places(accessToken: string | null, query?: PlacesListQuery): Promise<PlacesResponse>;
  createPlace(accessToken: string, body: PlaceCreateBody): Promise<unknown>;
  updatePlace(accessToken: string, id: string, body: PlaceUpdateBody): Promise<unknown>;
  placeHistory(accessToken: string, id: string, cursor?: string): Promise<CatalogHistoryResponse>;
}

export function createCatalogApi(config: CatalogApiConfig): CatalogApi {
  const client = (accessToken: string | null) =>
    createHttpClient({
      baseUrl: config.apiUrl,
      fetch: config.fetch,
      getAccessToken: () => accessToken,
    });
  return {
    areas: (accessToken, query = {}) =>
      client(accessToken).get(AreaRoutes.LIST, {
        schema: AreasResponseSchema,
        // includeInactive solo se envía si es true: el esquema lo lee con z.coerce.boolean.
        query: {
          q: query.q || undefined,
          kind: query.kind,
          includeInactive: query.includeInactive ? 'true' : undefined,
        },
      }),
    area: (accessToken, id) => client(accessToken).get(areaPath(id), { schema: AreaSchema }),
    createArea: (accessToken, body) =>
      client(accessToken).post(AreaRoutes.ADMIN_CREATE, { schema: z.unknown(), body }),
    updateArea: (accessToken, id, body) =>
      client(accessToken).patch(adminAreaPath(id), { schema: z.unknown(), body }),
    importAreas: (accessToken, body) =>
      client(accessToken).post(AreaRoutes.ADMIN_IMPORT, { schema: AreaImportResultSchema, body }),
    areaHistory: (accessToken, id, cursor) =>
      client(accessToken).get(adminAreaPath(id, true), {
        schema: CatalogHistoryResponseSchema,
        query: { cursor },
      }),
    places: (accessToken, query = {}) =>
      client(accessToken).get(PlaceRoutes.LIST, {
        schema: PlacesResponseSchema,
        query: {
          q: query.q || undefined,
          category: query.category,
          includeInactive: query.includeInactive ? 'true' : undefined,
          limit: query.limit ?? PLACES_PAGE_LIMIT,
        },
      }),
    createPlace: (accessToken, body) =>
      client(accessToken).post(PlaceRoutes.ADMIN_CREATE, { schema: z.unknown(), body }),
    updatePlace: (accessToken, id, body) =>
      client(accessToken).patch(adminPlacePath(id), { schema: z.unknown(), body }),
    placeHistory: (accessToken, id, cursor) =>
      client(accessToken).get(adminPlacePath(id, true), {
        schema: CatalogHistoryResponseSchema,
        query: { cursor },
      }),
  };
}
