// Interpreta la respuesta del PUT a la URL firmada (200 DriverDocument o error uniforme de la API).
import {
  ApiErrorBodySchema,
  ApiErrorCode,
  type DriverDocument,
  DriverDocumentSchema,
} from '@panter/contracts';
import { ApiError, ClientErrorCode } from '../../../shared/api/errors';

function parseJson(body: string): unknown {
  try {
    return body ? (JSON.parse(body) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

/** Código por estado HTTP cuando el cuerpo no trae el error uniforme. */
function fallbackCode(status: number): string {
  if (status === 401 || status === 403) return ApiErrorCode.UPLOAD_URL_INVALID;
  if (status === 413) return ApiErrorCode.DOCUMENT_TOO_LARGE;
  if (status === 415) return ApiErrorCode.DOCUMENT_TYPE_NOT_ALLOWED;
  if (status >= 400 && status < 500) return ApiErrorCode.BAD_REQUEST;
  return ApiErrorCode.INTERNAL_ERROR;
}

/** Devuelve el documento registrado o lanza `ApiError`. */
export function parsePutResponse(status: number, body: string): DriverDocument {
  const json = parseJson(body);
  if (status >= 200 && status < 300) {
    const parsed = DriverDocumentSchema.safeParse(json);
    if (parsed.success) return parsed.data;
    throw new ApiError(
      ClientErrorCode.INVALID_RESPONSE,
      'Respuesta inesperada al subir el documento',
      status,
      parsed.error,
    );
  }
  const error = ApiErrorBodySchema.safeParse(json);
  if (error.success) {
    const { code, message, details } = error.data.error;
    throw new ApiError(code, message, status, details);
  }
  throw new ApiError(fallbackCode(status), `La carga respondió ${status}`, status);
}
