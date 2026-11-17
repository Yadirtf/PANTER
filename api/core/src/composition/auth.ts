import type { Env } from '../env';
import type { Clock, OtpDelivery, UserRepository } from '../modules/auth/application/ports';
import { makeRequestOtp } from '../modules/auth/application/request-otp';
import { makeVerifyOtp } from '../modules/auth/application/verify-otp';
import { createDrizzleUserRepository } from '../modules/auth/infrastructure/drizzle-user-repository';
import { createHmacOtpHasher } from '../modules/auth/infrastructure/hmac-otp-hasher';
import { createKvOtpStore } from '../modules/auth/infrastructure/kv-otp-store';
import type { AuthFactories } from '../modules/auth/http/routes';
import { requireConfig } from './config';
import { buildDb } from './db';
import { buildSendOtpEmail } from './email';

/** Largo mínimo de OTP_SECRET (32 bytes en hexadecimal = 64 caracteres; se exige al menos 32). */
export const OTP_SECRET_MIN_LENGTH = 32;

export function requireOtpSecret(env: Pick<Env, 'OTP_SECRET'>): string {
  const secret = requireConfig(env.OTP_SECRET, 'OTP_SECRET', 'secreto');
  if (secret.length < OTP_SECRET_MIN_LENGTH) {
    throw new Error(
      `OTP_SECRET es muy corto (${secret.length} caracteres; mínimo ${OTP_SECRET_MIN_LENGTH}). Genera uno con: openssl rand -hex 32`,
    );
  }
  return secret;
}

/** Adaptadores reemplazables en pruebas (sin base de datos ni proveedor de correo). */
export interface AuthOverrides {
  users?: (env: Env) => UserRepository;
  deliver?: (env: Env) => OtpDelivery;
  clock?: Clock;
}

/** Raíz de composición del módulo auth. Cada fábrica se llama dentro del handler. */
export function buildAuthFactories(overrides: AuthOverrides = {}): AuthFactories {
  const users = overrides.users ?? ((env: Env) => createDrizzleUserRepository(buildDb(env)));
  const deliver = overrides.deliver ?? ((env: Env) => buildSendOtpEmail(env));
  return {
    requestOtp: (env) =>
      makeRequestOtp({
        store: createKvOtpStore(env.KV),
        hasher: createHmacOtpHasher(requireOtpSecret(env)),
        deliver: deliver(env),
        clock: overrides.clock,
        onDeliveryFailure: (error) =>
          console.error({
            event: 'otp_delivery_failed',
            error: error instanceof Error ? error.message : String(error),
          }),
      }),
    verifyOtp: (env) =>
      makeVerifyOtp({
        store: createKvOtpStore(env.KV),
        hasher: createHmacOtpHasher(requireOtpSecret(env)),
        users: users(env),
        clock: overrides.clock,
      }),
  };
}
