import { ApiErrorCode } from '@panter/contracts';
import { AppError } from '../../../shared/errors/app-error';

/** Errores del login con los códigos de @panter/contracts y mensajes para el usuario. */
export const AuthErrors = {
  otpRateLimited: (retryAfterSeconds: number) =>
    new AppError(
      ApiErrorCode.OTP_RATE_LIMITED,
      'Pediste demasiados códigos. Espera unos minutos e intenta de nuevo.',
      { status: 429, details: { retryAfterSeconds } },
    ),
  otpInvalid: (attemptsLeft: number) =>
    new AppError(
      ApiErrorCode.OTP_INVALID,
      'El código no es correcto. Revísalo e intenta otra vez.',
      {
        status: 400,
        details: { attemptsLeft },
      },
    ),
  otpExpired: () =>
    new AppError(ApiErrorCode.OTP_EXPIRED, 'El código venció o ya no es válido. Pide uno nuevo.', {
      status: 400,
    }),
  otpTooManyAttempts: () =>
    new AppError(
      ApiErrorCode.OTP_TOO_MANY_ATTEMPTS,
      'Fallaste el código demasiadas veces. Pide uno nuevo.',
      { status: 429 },
    ),
  accountSuspended: () =>
    new AppError(
      ApiErrorCode.ACCOUNT_SUSPENDED,
      'Tu cuenta está suspendida. Comunícate con PANTER para más información.',
      { status: 403 },
    ),
  unauthenticated: () =>
    new AppError(ApiErrorCode.UNAUTHENTICATED, 'Inicia sesión para continuar.', { status: 401 }),
  tokenExpired: () =>
    new AppError(ApiErrorCode.TOKEN_EXPIRED, 'Tu sesión expiró. Renuévala para continuar.', {
      status: 401,
    }),
  refreshTokenInvalid: () =>
    new AppError(
      ApiErrorCode.REFRESH_TOKEN_INVALID,
      'Tu sesión ya no es válida. Ingresa de nuevo con tu correo.',
      { status: 401 },
    ),
  forbidden: () =>
    new AppError(ApiErrorCode.FORBIDDEN, 'No tienes permiso para realizar esta acción.', {
      status: 403,
    }),
  modeNotAllowed: () =>
    new AppError(
      ApiErrorCode.MODE_NOT_ALLOWED,
      'Esta opción no está disponible en tu modo actual o para tu cuenta.',
      { status: 403 },
    ),
  modeChangeActiveTrip: () =>
    new AppError(
      ApiErrorCode.MODE_CHANGE_ACTIVE_TRIP,
      'No puedes cambiar de modo mientras tienes un viaje en curso. Termina el viaje e intenta de nuevo.',
      { status: 409 },
    ),
  /** No está en contracts: los clientes lo muestran con el mensaje genérico del servidor. */
  emailDeliveryFailed: () =>
    new AppError(
      'EMAIL_DELIVERY_FAILED',
      'No pudimos enviar el código a tu correo. Intenta de nuevo en unos minutos.',
      { status: 503 },
    ),
};
