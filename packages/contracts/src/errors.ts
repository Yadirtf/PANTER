import { z } from 'zod';

/** Cuerpo uniforme de error de la API: `{ error: { code, message, details? } }`. */
export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

/**
 * Códigos de error que los clientes deben distinguir para mostrar un mensaje propio.
 * Los genéricos (NOT_FOUND, VALIDATION_ERROR, BAD_REQUEST, INTERNAL_ERROR) los emite el
 * middleware de errores de api-core.
 */
export const ApiErrorCode = {
  // Genéricos
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // OTP (HU-101)
  OTP_RATE_LIMITED: 'OTP_RATE_LIMITED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_TOO_MANY_ATTEMPTS: 'OTP_TOO_MANY_ATTEMPTS',
  // Sesión (HU-103)
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  // Autorización (HU-104)
  FORBIDDEN: 'FORBIDDEN',
  MODE_NOT_ALLOWED: 'MODE_NOT_ALLOWED',
  MODE_CHANGE_ACTIVE_TRIP: 'MODE_CHANGE_ACTIVE_TRIP',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  // Correo (HU-102): el proveedor no pudo enviar el código (503)
  EMAIL_DELIVERY_FAILED: 'EMAIL_DELIVERY_FAILED',
  // Gestión de roles de personal (HU-108)
  ROLE_NOT_GRANTABLE: 'ROLE_NOT_GRANTABLE',
  CANNOT_REVOKE_OWN_ADMIN: 'CANNOT_REVOKE_OWN_ADMIN',
  // Consentimiento de datos (HU-109)
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  CONSENT_VERSION_OUTDATED: 'CONSENT_VERSION_OUTDATED',
  // Onboarding de conductores (E2)
  DRIVER_ALREADY_APPLIED: 'DRIVER_ALREADY_APPLIED',
  DRIVER_NOT_APPLIED: 'DRIVER_NOT_APPLIED',
  PLATE_ALREADY_REGISTERED: 'PLATE_ALREADY_REGISTERED',
  DOCUMENT_TOO_LARGE: 'DOCUMENT_TOO_LARGE',
  DOCUMENT_TYPE_NOT_ALLOWED: 'DOCUMENT_TYPE_NOT_ALLOWED',
  UPLOAD_URL_INVALID: 'UPLOAD_URL_INVALID',
  DOCUMENTS_INCOMPLETE: 'DOCUMENTS_INCOMPLETE',
  INVALID_DRIVER_TRANSITION: 'INVALID_DRIVER_TRANSITION',
  // Mapas, rutas y tarifas (E3, E4)
  OUT_OF_SERVICE_AREA: 'OUT_OF_SERVICE_AREA',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  ROUTING_UNAVAILABLE: 'ROUTING_UNAVAILABLE',
  FARE_RULE_NOT_FOUND: 'FARE_RULE_NOT_FOUND',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
