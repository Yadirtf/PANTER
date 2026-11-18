import {
  AdminDriversResponseSchema,
  DocumentViewUrlResponseSchema,
  type AdminDriversResponse,
  type DocumentReviewBody,
  type DocumentType,
  type DocumentViewUrlResponse,
  type DriverVerificationStatus,
} from '@panter/contracts';
import { z } from 'zod';
import { createHttpClient, type HttpClient } from '@/shared/api/http-client';
import type { DriverAction } from '../lib/drivers';

/** Rutas BFF de la revisión de conductores (mismo origen que la web; sin tokens en el navegador). */
export const DriversBffRoutes = {
  LIST: '/api/admin/drivers',
  action: (userId: string, action: DriverAction) =>
    `/api/admin/drivers/${encodeURIComponent(userId)}/${action}`,
  document: (userId: string, type: DocumentType, action: 'view-url' | 'review') =>
    `/api/admin/drivers/${encodeURIComponent(userId)}/documents/${type}/${action}`,
} as const;

export interface DriversClientConfig {
  /** Origen de la web; por defecto `window.location.origin`. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

function client(config: DriversClientConfig): HttpClient {
  return createHttpClient({
    baseUrl: config.baseUrl ?? window.location.origin,
    fetch: config.fetch,
  });
}

export function fetchDriversPage(
  params: { status?: DriverVerificationStatus; cursor?: string },
  config: DriversClientConfig = {},
): Promise<AdminDriversResponse> {
  return client(config).get(DriversBffRoutes.LIST, {
    schema: AdminDriversResponseSchema,
    query: { status: params.status, cursor: params.cursor },
  });
}

/** Pide una URL firmada nueva cuando la anterior venció (la imagen no cargó). */
export function fetchDocumentViewUrl(
  userId: string,
  type: DocumentType,
  config: DriversClientConfig = {},
): Promise<DocumentViewUrlResponse> {
  return client(config).get(DriversBffRoutes.document(userId, type, 'view-url'), {
    schema: DocumentViewUrlResponseSchema,
  });
}

export async function reviewDocument(
  userId: string,
  type: DocumentType,
  body: DocumentReviewBody,
  config: DriversClientConfig = {},
): Promise<void> {
  await client(config).post(DriversBffRoutes.document(userId, type, 'review'), {
    schema: z.unknown(),
    body,
  });
}

export async function driverAction(
  userId: string,
  action: DriverAction,
  reason?: string,
  config: DriversClientConfig = {},
): Promise<void> {
  await client(config).post(DriversBffRoutes.action(userId, action), {
    schema: z.unknown(),
    body: reason === undefined ? {} : { reason },
  });
}
