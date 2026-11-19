import {
  AdminDriverRoutes,
  AdminDriverSchema,
  AdminDriversResponseSchema,
  adminDocumentPath,
  adminDriverPath,
  DocumentViewUrlResponseSchema,
  type AdminDriver,
  type AdminDriversResponse,
  type DocumentReviewBody,
  type DocumentType,
  type DocumentViewUrlResponse,
  type DriverVerificationStatus,
} from '@panter/contracts';
import { z } from 'zod';
import { createHttpClient } from '@/shared/api/http-client';
import type { DriverAction } from '../lib/drivers';

export interface DriversApiConfig {
  /** URL base de panter-api. */
  apiUrl: string;
  /** Inyectable para pruebas; por defecto el `fetch` global. */
  fetch?: typeof fetch;
}

export interface AdminDriversParams {
  status?: DriverVerificationStatus;
  cursor?: string;
  limit?: number;
}

/**
 * Las respuestas de las acciones no se interpretan: tras cada cambio la web vuelve a pedir el
 * detalle (router.refresh), que trae el estado y URLs firmadas nuevas. Así no dependemos de la
 * forma exacta de esas respuestas.
 */
const AnyResponseSchema = z.unknown();

/**
 * Llamadas de servidor a servidor a la revisión de conductores (HU-204). Cada método recibe el
 * access token de la cookie y lo envía como Bearer; el navegador nunca lo ve.
 */
export interface DriversApi {
  list(accessToken: string, params: AdminDriversParams): Promise<AdminDriversResponse>;
  detail(accessToken: string, userId: string): Promise<AdminDriver>;
  viewUrl(
    accessToken: string,
    userId: string,
    type: DocumentType,
  ): Promise<DocumentViewUrlResponse>;
  reviewDocument(
    accessToken: string,
    userId: string,
    type: DocumentType,
    body: DocumentReviewBody,
  ): Promise<unknown>;
  act(accessToken: string, userId: string, action: DriverAction, reason?: string): Promise<unknown>;
}

export function createDriversApi(config: DriversApiConfig): DriversApi {
  const client = (accessToken: string) =>
    createHttpClient({
      baseUrl: config.apiUrl,
      fetch: config.fetch,
      getAccessToken: () => accessToken,
    });
  return {
    list: (accessToken, params) =>
      client(accessToken).get(AdminDriverRoutes.LIST, {
        schema: AdminDriversResponseSchema,
        query: { status: params.status, cursor: params.cursor, limit: params.limit },
      }),
    detail: (accessToken, userId) =>
      client(accessToken).get(adminDriverPath(userId), { schema: AdminDriverSchema }),
    viewUrl: (accessToken, userId, type) =>
      client(accessToken).get(adminDocumentPath(userId, type, 'view-url'), {
        schema: DocumentViewUrlResponseSchema,
      }),
    reviewDocument: (accessToken, userId, type, body) =>
      client(accessToken).post(adminDocumentPath(userId, type, 'review'), {
        schema: AnyResponseSchema,
        body,
      }),
    act: (accessToken, userId, action, reason) =>
      client(accessToken).post(adminDriverPath(userId, action), {
        schema: AnyResponseSchema,
        body: reason === undefined ? {} : { reason },
      }),
  };
}
