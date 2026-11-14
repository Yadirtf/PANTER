import {
  OTP_MAX_CODES_PER_WINDOW,
  OTP_RESEND_AFTER_SECONDS,
  OTP_TTL_SECONDS,
  OTP_WINDOW_SECONDS,
  type OtpRequestBody,
  type OtpRequestResponse,
} from '@panter/contracts';
import { generateOtpCode, type RandomValues } from '../domain/otp-code';
import { AuthErrors } from './errors';
import { codeHash, emailKey } from './otp-keys';
import type { Clock, OtpDelivery, OtpHasher, OtpStore } from './ports';

export interface RequestOtpDeps {
  store: OtpStore;
  hasher: OtpHasher;
  deliver: OtpDelivery;
  clock?: Clock;
  random?: RandomValues;
  /** Se llama con el error del proveedor si no se pudo entregar el código (para logs). */
  onDeliveryFailure?: (error: unknown) => void;
}

export type RequestOtp = (input: OtpRequestBody) => Promise<OtpRequestResponse>;

/** Respuesta 202: idéntica exista o no la cuenta. */
export const OTP_SENT: OtpRequestResponse = {
  status: 'sent',
  expiresInSeconds: OTP_TTL_SECONDS,
  resendAfterSeconds: OTP_RESEND_AFTER_SECONDS,
};

/**
 * Caso de uso POST /auth/otp/request (HU-101).
 *
 * No consulta la base de datos: el trabajo (y por tanto el tiempo de respuesta) es el mismo
 * exista o no la cuenta, y la respuesta siempre es `OTP_SENT`. La cuenta se crea al verificar.
 *
 * 1. Límite: `OTP_MAX_CODES_PER_WINDOW` códigos por correo en una ventana fija de
 *    `OTP_WINDOW_SECONDS` → `OTP_RATE_LIMITED` (429) con `retryAfterSeconds`.
 * 2. Genera el código, guarda solo su HMAC con vencimiento de `OTP_TTL_SECONDS` (un código nuevo
 *    reemplaza al anterior y reinicia los intentos) y lo envía por correo.
 * 3. Si el correo no sale, borra el código y responde `EMAIL_DELIVERY_FAILED` (503).
 */
export function makeRequestOtp(deps: RequestOtpDeps): RequestOtp {
  const now = deps.clock ?? Date.now;
  return async ({ email }) => {
    const key = await emailKey(deps.hasher, email);
    const at = now();

    const current = await deps.store.getRequestWindow(key);
    const open = current !== null && current.resetAt > at;
    if (open && current.count >= OTP_MAX_CODES_PER_WINDOW) {
      throw AuthErrors.otpRateLimited(Math.ceil((current.resetAt - at) / 1000));
    }
    await deps.store.putRequestWindow(
      key,
      open
        ? { count: current.count + 1, resetAt: current.resetAt }
        : { count: 1, resetAt: at + OTP_WINDOW_SECONDS * 1000 },
    );

    const code = generateOtpCode(deps.random);
    await deps.store.putCode(key, {
      hash: await codeHash(deps.hasher, email, code),
      attempts: 0,
      expiresAt: at + OTP_TTL_SECONDS * 1000,
    });

    try {
      await deps.deliver(email, code);
    } catch (error) {
      deps.onDeliveryFailure?.(error);
      await deps.store.deleteCode(key);
      throw AuthErrors.emailDeliveryFailed();
    }
    return OTP_SENT;
  };
}
