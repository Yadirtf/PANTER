// Reglas de reintento de la cola de subida (HU-203): qué hacer ante cada error y cuánto esperar.
import { ApiErrorCode } from '@panter/contracts';
import { ClientErrorCode } from '../../../shared/api/errors';

/**
 * - network: no hubo respuesta (sin señal, DNS, timeout): se espera la red o se hace backoff;
 * - urlExpired: la URL firmada venció o no es válida: se pide otra de inmediato;
 * - fatal: la API rechazó el archivo o la solicitud; reintentar no sirve (hay que tomar otra foto);
 * - transient: error del servidor o respuesta inesperada: backoff.
 */
export type UploadFailureKind = 'network' | 'urlExpired' | 'fatal' | 'transient';

const FATAL_CODES = new Set<string>([
  ApiErrorCode.DOCUMENT_TOO_LARGE,
  ApiErrorCode.DOCUMENT_TYPE_NOT_ALLOWED,
  ApiErrorCode.VALIDATION_ERROR,
  ApiErrorCode.BAD_REQUEST,
  ApiErrorCode.DRIVER_NOT_APPLIED,
  ApiErrorCode.INVALID_DRIVER_TRANSITION,
  ApiErrorCode.FORBIDDEN,
  ApiErrorCode.NOT_FOUND,
]);

export function classifyUploadError(code: string): UploadFailureKind {
  if (code === ClientErrorCode.NETWORK_ERROR) return 'network';
  if (code === ApiErrorCode.UPLOAD_URL_INVALID) return 'urlExpired';
  if (FATAL_CODES.has(code)) return 'fatal';
  return 'transient';
}

export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;
/** Si a la URL firmada le queda menos que esto, se pide una nueva antes del PUT. */
export const URL_EXPIRY_MARGIN_MS = 30_000;

/**
 * Espera antes del intento `attempt` (1 = primer reintento): 2 s, 4 s, 8 s… hasta 60 s, con
 * ±20 % de variación para que varios teléfonos no reintenten a la vez tras un corte.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
  return Math.round(base * (0.8 + 0.4 * random()));
}

/**
 * Hay red utilizable salvo que el sistema diga lo contrario. Si no lo sabe (`undefined`), se
 * intenta: el resultado de la petición decide.
 */
export function isOnlineState(state: {
  isConnected?: boolean;
  isInternetReachable?: boolean;
}): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}
