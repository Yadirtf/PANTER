// Endpoints del onboarding de conductores (contrato de packages/contracts/src/drivers.ts).
import {
  ApiErrorCode,
  type DocumentType,
  type DocumentUploadUrlBody,
  type DocumentUploadUrlResponse,
  DocumentUploadUrlResponseSchema,
  type DriverApplyBody,
  type DriverProfile,
  DriverProfileSchema,
  DriverRoutes,
  documentUploadUrlPath,
} from '@panter/contracts';
import { isApiError } from '../../../shared/api/errors';
import type { HttpClient } from '../../../shared/api/http-client';

export interface DriversApi {
  /**
   * POST /drivers/apply. Errores esperados: 409 DRIVER_ALREADY_APPLIED y
   * 409 PLATE_ALREADY_REGISTERED.
   */
  apply(body: DriverApplyBody): Promise<DriverProfile>;
  /** GET /drivers/me; `null` si la persona todavía no ha solicitado ser conductor. */
  getMe(): Promise<DriverProfile | null>;
  /** POST /drivers/me/documents/:type/upload-url: URL firmada para el PUT del archivo. */
  requestUploadUrl(
    type: DocumentType,
    body: DocumentUploadUrlBody,
  ): Promise<DocumentUploadUrlResponse>;
}

/** Códigos con los que la API indica que aún no hay solicitud de conductor. */
const NOT_APPLIED_CODES = new Set<string>([
  ApiErrorCode.DRIVER_NOT_APPLIED,
  ApiErrorCode.NOT_FOUND,
]);

export function createDriversApi(http: HttpClient): DriversApi {
  return {
    apply: (body) =>
      http.request({ path: DriverRoutes.APPLY, body, auth: true, schema: DriverProfileSchema }),
    async getMe() {
      try {
        return await http.request({
          path: DriverRoutes.ME,
          auth: true,
          schema: DriverProfileSchema,
        });
      } catch (error) {
        if (isApiError(error) && NOT_APPLIED_CODES.has(error.code)) return null;
        throw error;
      }
    },
    requestUploadUrl: (type, body) =>
      http.request({
        path: documentUploadUrlPath(type),
        body,
        auth: true,
        schema: DocumentUploadUrlResponseSchema,
      }),
  };
}
