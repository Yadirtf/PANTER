import type { Env } from '../env';
import { makeGetMe, makeSwitchMode } from '../modules/auth/application/me';
import type {
  AccessTokenVerifier,
  ActiveTripChecker,
  Clock,
  ConsentStatusReader,
  DriverAvailability,
  DriverModeEligibility,
  OtpDelivery,
  UserRepository,
} from '../modules/auth/application/ports';
import { makeRequestOtp } from '../modules/auth/application/request-otp';
import {
  makeIssueSession,
  makeLogout,
  makeRefreshSession,
  makeSignInWithOtp,
  type IssueSession,
} from '../modules/auth/application/session';
import { makeVerifyOtp } from '../modules/auth/application/verify-otp';
import type { MeFactories } from '../modules/auth/http/me-routes';
import type { AuthFactories } from '../modules/auth/http/routes';
import { makeRequireAuth } from '../modules/auth/http/require-auth';
import { createDrizzleUserRepository } from '../modules/auth/infrastructure/drizzle-user-repository';
import { createHmacOtpHasher } from '../modules/auth/infrastructure/hmac-otp-hasher';
import {
  buildJwks,
  createJoseAccessTokenSigner,
  createJoseAccessTokenVerifier,
} from '../modules/auth/infrastructure/jose-access-tokens';
import { createKvOtpStore } from '../modules/auth/infrastructure/kv-otp-store';
import { noActiveTrips } from '../modules/auth/infrastructure/pending-adapters';
import {
  createKvRefreshTokenStore,
  createRefreshTokenCodec,
} from '../modules/auth/infrastructure/refresh-tokens';
import { makeGetConsentStatus } from '../modules/consent/application/consent';
import { requireConfig } from './config';
import { defaultConsentRepository } from './consent';
import { buildDb } from './db';
import { defaultDriverAvailability, defaultDriverEligibility } from './drivers';
import { buildSendOtpEmail } from './email';

/** Largo mínimo de OTP_SECRET (`openssl rand -hex 32` da 64 caracteres; se exige al menos 32). */
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

const jwtKid = (env: Pick<Env, 'JWT_KID'>) => requireConfig(env.JWT_KID, 'JWT_KID', 'var');
const jwtPublicKey = (env: Pick<Env, 'JWT_PUBLIC_KEY'>) =>
  requireConfig(env.JWT_PUBLIC_KEY, 'JWT_PUBLIC_KEY', 'secreto');

/** Verificador de access tokens: solo necesita JWT_PUBLIC_KEY. */
export function buildAccessTokenVerifier(env: Env, clock?: Clock): AccessTokenVerifier {
  return createJoseAccessTokenVerifier({ publicKeyPem: jwtPublicKey(env), now: clock });
}

/**
 * Middleware `requireAuth()` listo para usar en cualquier módulo (HU-104):
 * `router.use('/me/*', requireAuth())`, y en el handler `getActor(c)`.
 */
export const requireAuth = makeRequireAuth((env) => buildAccessTokenVerifier(env));

/** Adaptadores reemplazables en pruebas (sin base de datos ni proveedor de correo). */
export interface AuthOverrides {
  users?: (env: Env) => UserRepository;
  deliver?: (env: Env) => OtpDelivery;
  /** Por defecto `noActiveTrips` hasta HU-602. */
  activeTrips?: (env: Env) => ActiveTripChecker;
  /** HU-201: por defecto driver_profiles.availability = OFFLINE (módulo drivers). */
  driverAvailability?: (env: Env) => DriverAvailability;
  /** HU-201: por defecto verification_status APPROVED en driver_profiles (módulo drivers). */
  driverEligibility?: (env: Env) => DriverModeEligibility;
  /** Estado del consentimiento (HU-109). Por defecto, el módulo consent sobre Postgres. */
  consent?: (env: Env) => ConsentStatusReader;
  clock?: Clock;
}

/** Fábricas del login (AuthFactories) y de la sesión actual (/me, MeFactories). */
export type IdentityFactories = AuthFactories & MeFactories;

/** Raíz de composición del módulo auth. Cada fábrica se llama dentro del handler. */
export function buildAuthFactories(overrides: AuthOverrides = {}): IdentityFactories {
  const { clock } = overrides;
  const users = overrides.users ?? ((env: Env) => createDrizzleUserRepository(buildDb(env)));
  const deliver = overrides.deliver ?? ((env: Env) => buildSendOtpEmail(env));
  const activeTrips = overrides.activeTrips ?? (() => noActiveTrips);
  const driverAvailability = overrides.driverAvailability ?? defaultDriverAvailability;
  const driverEligibility = overrides.driverEligibility ?? defaultDriverEligibility;
  const consent =
    overrides.consent ??
    ((env: Env) => makeGetConsentStatus({ repo: defaultConsentRepository(env) }));
  const otpStore = (env: Env) => createKvOtpStore(env.KV, clock);
  const refreshStore = (env: Env) => createKvRefreshTokenStore(env.KV, clock);
  const codec = createRefreshTokenCodec();

  const issueSession = (env: Env): IssueSession =>
    makeIssueSession({
      signer: createJoseAccessTokenSigner({
        privateKeyPem: requireConfig(env.JWT_PRIVATE_KEY, 'JWT_PRIVATE_KEY', 'secreto'),
        kid: jwtKid(env),
        now: clock,
      }),
      refreshStore: refreshStore(env),
      codec,
      clock,
      consent: consent(env),
    });

  return {
    requestOtp: (env) =>
      makeRequestOtp({
        store: otpStore(env),
        hasher: createHmacOtpHasher(requireOtpSecret(env)),
        deliver: deliver(env),
        clock,
        onDeliveryFailure: (error) =>
          console.error({
            event: 'otp_delivery_failed',
            error: error instanceof Error ? error.message : String(error),
          }),
      }),
    signIn: (env) => {
      // Se arma la sesión antes de verificar: si faltan las llaves JWT, el código no se gasta.
      const session = issueSession(env);
      return makeSignInWithOtp({
        verifyOtp: makeVerifyOtp({
          store: otpStore(env),
          hasher: createHmacOtpHasher(requireOtpSecret(env)),
          users: users(env),
          clock,
        }),
        issueSession: session,
      });
    },
    refresh: (env) =>
      makeRefreshSession({
        refreshStore: refreshStore(env),
        codec,
        users: users(env),
        issueSession: issueSession(env),
        clock,
        driverEligibility: driverEligibility(env),
        onReuseDetected: (info) => console.warn({ event: 'refresh_token_reuse', ...info }),
      }),
    logout: (env) => makeLogout({ refreshStore: refreshStore(env), codec, clock }),
    jwks: (env) => () => buildJwks(jwtPublicKey(env), jwtKid(env)),
    getMe: (env) => makeGetMe({ users: users(env), consent: consent(env) }),
    switchMode: (env) =>
      makeSwitchMode({
        users: users(env),
        activeTrips: activeTrips(env),
        driverAvailability: driverAvailability(env),
        driverEligibility: driverEligibility(env),
        refreshStore: refreshStore(env),
        issueSession: issueSession(env),
        clock,
      }),
  };
}
