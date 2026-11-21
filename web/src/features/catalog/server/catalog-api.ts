import {
  adminAreaPath,
  AreaImportResultSchema,
  AreaRoutes,
  AreaSchema,
  AreasResponseSchema,
  areaPath,
  CatalogHistoryResponseSchema,
  type Area,
  type AreaCreateBody,
  type AreaImportBody,
  type AreaImportResult,
  type AreaKind,
  type AreasResponse,
  type AreaUpdateBody,
  type CatalogHistoryResponse,
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

/**
 * Llamadas de servidor a servidor al catálogo geográfico (E15) con el access token de la cookie
 * como Bearer: barrios y veredas (HU-308/HU-309). Las respuestas de crear y editar se devuelven
 * tal cual (el navegador las lee con AreaSchema si las necesita).
 */
export interface CatalogApi {
  areas(accessToken: string, query?: AreasListQuery): Promise<AreasResponse>;
  area(accessToken: string, id: string): Promise<Area>;
  createArea(accessToken: string, body: AreaCreateBody): Promise<unknown>;
  updateArea(accessToken: string, id: string, body: AreaUpdateBody): Promise<unknown>;
  importAreas(accessToken: string, body: AreaImportBody): Promise<AreaImportResult>;
  areaHistory(accessToken: string, id: string, cursor?: string): Promise<CatalogHistoryResponse>;
}

export function createCatalogApi(config: CatalogApiConfig): CatalogApi {
  const client = (accessToken: string) =>
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
  };
}
