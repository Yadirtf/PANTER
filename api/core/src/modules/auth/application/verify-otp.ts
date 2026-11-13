import { OTP_MAX_VERIFY_ATTEMPTS, type OtpVerifyBody } from '@panter/contracts';
import { timingSafeEqual } from '../domain/otp-code';
import { canSignIn, type User } from '../domain/user';
import { AuthErrors } from './errors';
import { codeHash, emailKey } from './otp-keys';
import type { Clock, OtpHasher, OtpStore, UserRepository } from './ports';

export interface VerifyOtpDeps {
  store: OtpStore;
  hasher: OtpHasher;
  users: UserRepository;
  clock?: Clock;
}

/** Devuelve la cuenta (creada si no existía) cuyo correo se acaba de comprobar. */
export type VerifyOtp = (input: OtpVerifyBody) => Promise<User>;

/**
 * Caso de uso POST /auth/otp/verify (HU-101).
 *
 * - Sin código vigente (nunca pedido, vencido, ya usado o invalidado) → `OTP_EXPIRED`.
 * - Código incorrecto → `OTP_INVALID` con `attemptsLeft`; al llegar a `OTP_MAX_VERIFY_ATTEMPTS`
 *   fallos el código se invalida → `OTP_TOO_MANY_ATTEMPTS`.
 * - La comparación de hashes es en tiempo constante.
 * - Código correcto → se borra (un solo uso) y se busca o crea la cuenta con rol PASSENGER.
 *   Cuentas SUSPENDED o DELETED → `ACCOUNT_SUSPENDED`.
 */
export function makeVerifyOtp(deps: VerifyOtpDeps): VerifyOtp {
  const now = deps.clock ?? Date.now;
  return async ({ email, code }) => {
    const key = await emailKey(deps.hasher, email);
    const record = await deps.store.getCode(key);
    if (!record) throw AuthErrors.otpExpired();
    if (record.expiresAt <= now()) {
      await deps.store.deleteCode(key);
      throw AuthErrors.otpExpired();
    }

    const candidate = await codeHash(deps.hasher, email, code);
    if (!timingSafeEqual(candidate, record.hash)) {
      const attempts = record.attempts + 1;
      if (attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
        await deps.store.deleteCode(key);
        throw AuthErrors.otpTooManyAttempts();
      }
      await deps.store.putCode(key, { ...record, attempts });
      throw AuthErrors.otpInvalid(OTP_MAX_VERIFY_ATTEMPTS - attempts);
    }

    await deps.store.deleteCode(key);
    const user = await deps.users.findOrCreatePassenger(email);
    if (!canSignIn(user)) throw AuthErrors.accountSuspended();
    return user;
  };
}
