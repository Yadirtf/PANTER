// Mensajes en español para cada código de error. El `Record` obliga a cubrir todos los códigos
// de @panter/contracts: si el contrato agrega uno, TypeScript exige su mensaje aquí.
import { OTP_MAX_VERIFY_ATTEMPTS, OTP_TTL_SECONDS, OTP_WINDOW_SECONDS } from '@panter/contracts';
import { type AppErrorCode, isKnownErrorCode } from './errors';

const OTP_TTL_MINUTES = OTP_TTL_SECONDS / 60;
const OTP_WINDOW_MINUTES = OTP_WINDOW_SECONDS / 60;

export const ERROR_MESSAGES: Record<AppErrorCode, string> = {
  // Cliente
  NETWORK_ERROR: 'No hay conexión a internet. Revisa tus datos o el wifi e intenta de nuevo.',
  INVALID_RESPONSE: 'Recibimos una respuesta inesperada del servidor. Intenta de nuevo más tarde.',
  // Genéricos
  NOT_FOUND: 'No encontramos lo que buscas.',
  VALIDATION_ERROR: 'Revisa los datos: hay un campo vacío o con un formato incorrecto.',
  BAD_REQUEST: 'No pudimos procesar la solicitud. Revisa los datos e intenta de nuevo.',
  INTERNAL_ERROR: 'Algo salió mal en el servidor. Intenta de nuevo en unos minutos.',
  // OTP
  OTP_RATE_LIMITED: `Pediste demasiados códigos. Espera unos ${OTP_WINDOW_MINUTES} minutos e intenta de nuevo.`,
  OTP_INVALID: 'El código no es correcto. Revísalo en tu correo y escríbelo de nuevo.',
  OTP_EXPIRED: `El código venció (dura ${OTP_TTL_MINUTES} minutos). Pide uno nuevo.`,
  OTP_TOO_MANY_ATTEMPTS: `Fallaste el código ${OTP_MAX_VERIFY_ATTEMPTS} veces. Pide un código nuevo.`,
  // Sesión
  UNAUTHENTICATED: 'Tu sesión terminó. Ingresa de nuevo con tu correo.',
  TOKEN_EXPIRED: 'Tu sesión venció. Ingresa de nuevo con tu correo.',
  REFRESH_TOKEN_INVALID: 'Tu sesión venció. Ingresa de nuevo con tu correo.',
  // Autorización
  FORBIDDEN: 'No tienes permiso para hacer esto.',
  MODE_NOT_ALLOWED:
    'Para usar el modo conductor debes ser un conductor aprobado. Completa tu registro de conductor.',
  MODE_CHANGE_ACTIVE_TRIP:
    'Tienes un viaje en curso. Termínalo o cancélalo antes de cambiar de modo.',
  ACCOUNT_SUSPENDED: 'Tu cuenta está suspendida. Comunícate con PANTER para más información.',
};

/** Mensaje para mostrar al usuario a partir de un error normalizado `{ code }`. */
export function errorMessage(error: { code: string }): string {
  return isKnownErrorCode(error.code) ? ERROR_MESSAGES[error.code] : ERROR_MESSAGES.INTERNAL_ERROR;
}
