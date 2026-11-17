import { ApiErrorBodySchema, type ApiErrorBody } from '@panter/contracts';

/** Formato de error de la API (sección 4): esquema oficial de @panter/contracts. */
export { ApiErrorBodySchema, type ApiErrorBody };

/** Códigos que genera el propio cliente cuando la API no devuelve un error con formato. */
export const ClientErrorCode = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  ABORTED: 'ABORTED',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  HTTP_ERROR: 'HTTP_ERROR',
  UNKNOWN: 'UNKNOWN',
} as const;
export type ClientErrorCode = (typeof ClientErrorCode)[keyof typeof ClientErrorCode];

/** Error normalizado que lanza el cliente HTTP en cualquier fallo. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: string;
  /** Código HTTP; `0` si la petición no llegó a responder. */
  readonly status: number;
  readonly details?: unknown;

  constructor(params: { code: string; message: string; status?: number; details?: unknown }) {
    super(params.message);
    this.code = params.code;
    this.status = params.status ?? 0;
    this.details = params.details;
  }

  toJSON(): ApiErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Convierte cualquier valor lanzado en un `ApiError`. */
export function toApiError(value: unknown): ApiError {
  if (isApiError(value)) return value;
  if (value instanceof DOMException && value.name === 'AbortError') {
    return new ApiError({ code: ClientErrorCode.ABORTED, message: 'La petición fue cancelada.' });
  }
  if (value instanceof Error) {
    return new ApiError({ code: ClientErrorCode.UNKNOWN, message: value.message });
  }
  return new ApiError({ code: ClientErrorCode.UNKNOWN, message: 'Error desconocido.' });
}

/** Normaliza cualquier error al formato `{ error: { code, message } }`. */
export function toErrorBody(value: unknown): ApiErrorBody {
  return toApiError(value).toJSON();
}
