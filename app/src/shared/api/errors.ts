// Errores normalizados del cliente HTTP: todo fallo llega a la interfaz como `{ code, message }`.
import { ApiErrorCode } from '@panter/contracts';

/** Códigos propios del cliente, además de los que emite la API. */
export const ClientErrorCode = {
  /** Sin conexión, DNS caído o tiempo de espera agotado: la petición no llegó a la API. */
  NETWORK_ERROR: 'NETWORK_ERROR',
  /** La API respondió algo que no cumple el contrato de @panter/contracts. */
  INVALID_RESPONSE: 'INVALID_RESPONSE',
} as const;
export type ClientErrorCode = (typeof ClientErrorCode)[keyof typeof ClientErrorCode];

export type AppErrorCode = ApiErrorCode | ClientErrorCode;

const KNOWN_CODES = new Set<string>([
  ...Object.values(ApiErrorCode),
  ...Object.values(ClientErrorCode),
]);

/** Indica si `code` es uno de los códigos que la app sabe mostrar. */
export function isKnownErrorCode(code: string): code is AppErrorCode {
  return KNOWN_CODES.has(code);
}

/** Forma plana del error que consumen las pantallas. */
export interface NormalizedError {
  readonly code: string;
  readonly message: string;
}

/**
 * Error de la API o del cliente. `code` es el código de la API tal cual (puede ser uno que la
 * app aún no conozca); `message` es el que envió la API o uno genérico del cliente.
 */
export class ApiError extends Error implements NormalizedError {
  readonly code: string;
  /** Código HTTP; 0 si la petición no llegó a la API. */
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status = 0, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON(): NormalizedError {
    return { code: this.code, message: this.message };
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Convierte cualquier error en `ApiError` (lo desconocido se trata como fallo interno). */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ApiError(ApiErrorCode.INTERNAL_ERROR, message);
}

export function networkError(cause?: unknown): ApiError {
  const detail = cause instanceof Error ? cause.message : undefined;
  return new ApiError(ClientErrorCode.NETWORK_ERROR, 'No se pudo conectar con la API', 0, detail);
}
