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
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
