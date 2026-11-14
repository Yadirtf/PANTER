import { ApiErrorCode } from '@panter/contracts';
import { ClientErrorCode } from '@/shared/api/errors';

export const STAFF_ONLY_MESSAGE = 'Esta web es para el personal; usa la app PANTER.';

/** Mensajes del login para cada código de error que puede devolver el flujo OTP. */
export const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  [ApiErrorCode.OTP_RATE_LIMITED]:
    'Ya pediste varios códigos. Espera unos minutos antes de pedir otro.',
  [ApiErrorCode.OTP_INVALID]: 'El código no es correcto. Revísalo e intenta de nuevo.',
  [ApiErrorCode.OTP_EXPIRED]: 'El código venció. Pide uno nuevo.',
  [ApiErrorCode.OTP_TOO_MANY_ATTEMPTS]:
    'Hiciste demasiados intentos con este código. Pide uno nuevo.',
  [ApiErrorCode.VALIDATION_ERROR]: 'Revisa el correo y el código e intenta de nuevo.',
  [ApiErrorCode.BAD_REQUEST]: 'Revisa el correo y el código e intenta de nuevo.',
  [ApiErrorCode.ACCOUNT_SUSPENDED]:
    'Tu cuenta está suspendida. Comunícate con el administrador de PANTER.',
  [ApiErrorCode.FORBIDDEN]: STAFF_ONLY_MESSAGE,
  [ApiErrorCode.INTERNAL_ERROR]: 'Tuvimos un problema. Intenta de nuevo en un momento.',
  [ClientErrorCode.NETWORK_ERROR]:
    'No pudimos conectar con PANTER. Revisa tu conexión e intenta de nuevo.',
};

const FALLBACK_MESSAGE = 'No pudimos iniciar sesión. Intenta de nuevo.';

export function loginErrorMessage(code: string): string {
  return LOGIN_ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE;
}

/** Errores tras los cuales el código actual ya no sirve y hay que pedir otro. */
export function requiresNewCode(code: string): boolean {
  return code === ApiErrorCode.OTP_EXPIRED || code === ApiErrorCode.OTP_TOO_MANY_ATTEMPTS;
}
