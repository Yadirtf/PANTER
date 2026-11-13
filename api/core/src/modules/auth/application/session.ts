import {
  ActiveMode,
  REFRESH_TOKEN_TTL_SECONDS,
  type OtpVerifyBody,
  type RefreshBody,
  type TokenPairResponse,
} from '@panter/contracts';
import { canSignIn, resolveActiveMode, toProfile, type User } from '../domain/user';
import { AuthErrors } from './errors';
import type {
  AccessTokenSigner,
  Clock,
  RefreshTokenCodec,
  RefreshTokenStore,
  UserRepository,
} from './ports';
import type { VerifyOtp } from './verify-otp';

export interface SessionDeps {
  signer: AccessTokenSigner;
  refreshStore: RefreshTokenStore;
  codec: RefreshTokenCodec;
  newId?: () => string;
  clock?: Clock;
}

/** Emite un par access + refresh. Sin `familyId` abre una sesión (familia) nueva. */
export type IssueSession = (
  user: User,
  activeMode: ActiveMode,
  familyId?: string,
) => Promise<TokenPairResponse>;

export function makeIssueSession(deps: SessionDeps): IssueSession {
  const now = deps.clock ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  return async (user, requestedMode, familyId = newId()) => {
    const activeMode = resolveActiveMode(user.roles, requestedMode);
    const access = await deps.signer.sign({ userId: user.id, roles: user.roles, activeMode });
    const refreshToken = deps.codec.generate();
    await deps.refreshStore.put(await deps.codec.hash(refreshToken), {
      userId: user.id,
      activeMode,
      familyId,
      expiresAt: now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
    return {
      tokenType: 'Bearer',
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken,
      refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
      user: toProfile(user, activeMode),
    };
  };
}

/** POST /auth/otp/verify: comprueba el código y abre sesión en modo pasajero (§5.3). */
export type SignInWithOtp = (input: OtpVerifyBody) => Promise<TokenPairResponse>;

export function makeSignInWithOtp(deps: {
  verifyOtp: VerifyOtp;
  issueSession: IssueSession;
}): SignInWithOtp {
  return async (input) => deps.issueSession(await deps.verifyOtp(input), ActiveMode.PASSENGER);
}

export interface RefreshDeps {
  refreshStore: RefreshTokenStore;
  codec: RefreshTokenCodec;
  users: UserRepository;
  issueSession: IssueSession;
  clock?: Clock;
  /** Se llama al detectar la reutilización de un refresh token ya rotado (para logs). */
  onReuseDetected?: (info: { userId: string; familyId: string }) => void;
}

export type RefreshSession = (input: RefreshBody) => Promise<TokenPairResponse>;

/**
 * POST /auth/refresh: rotación con detección de reutilización.
 *
 * - Token desconocido o vencido → `REFRESH_TOKEN_INVALID`.
 * - Token ya rotado (alguien lo reutiliza: posible robo) → se revoca toda la familia y
 *   `REFRESH_TOKEN_INVALID`. El dueño legítimo tendrá que volver a ingresar.
 * - Familia revocada (logout o reutilización previa) → `REFRESH_TOKEN_INVALID`.
 * - Si no, el token se marca como rotado y se emite un par nuevo de la misma familia, con los
 *   roles actuales de la base de datos y el modo activo de la sesión. Cuenta suspendida o
 *   borrada → se revoca la familia y `ACCOUNT_SUSPENDED` (o `REFRESH_TOKEN_INVALID` si ya no
 *   existe).
 */
export function makeRefreshSession(deps: RefreshDeps): RefreshSession {
  const now = deps.clock ?? Date.now;
  const familyUntil = () => now() + REFRESH_TOKEN_TTL_SECONDS * 1000;
  return async ({ refreshToken }) => {
    const hash = await deps.codec.hash(refreshToken);
    const record = await deps.refreshStore.get(hash);
    if (!record || record.expiresAt <= now()) throw AuthErrors.refreshTokenInvalid();

    if (record.rotated) {
      await deps.refreshStore.revokeFamily(record.familyId, familyUntil());
      deps.onReuseDetected?.({ userId: record.userId, familyId: record.familyId });
      throw AuthErrors.refreshTokenInvalid();
    }
    if (await deps.refreshStore.isFamilyRevoked(record.familyId)) {
      throw AuthErrors.refreshTokenInvalid();
    }

    await deps.refreshStore.put(hash, { ...record, rotated: true });

    const user = await deps.users.findById(record.userId);
    if (!user || !canSignIn(user)) {
      await deps.refreshStore.revokeFamily(record.familyId, familyUntil());
      throw user ? AuthErrors.accountSuspended() : AuthErrors.refreshTokenInvalid();
    }
    return deps.issueSession(user, record.activeMode, record.familyId);
  };
}

export type Logout = (input: RefreshBody) => Promise<void>;

/**
 * POST /auth/logout: borra el refresh token y revoca su familia (cierra esa sesión en todos los
 * tokens rotados que pudieran quedar). Idempotente: un token desconocido también responde 204.
 * El access token vigente sigue siendo válido hasta su vencimiento (15 min); los clientes lo
 * descartan al cerrar sesión.
 */
export function makeLogout(deps: {
  refreshStore: RefreshTokenStore;
  codec: RefreshTokenCodec;
  clock?: Clock;
}): Logout {
  const now = deps.clock ?? Date.now;
  return async ({ refreshToken }) => {
    const hash = await deps.codec.hash(refreshToken);
    const record = await deps.refreshStore.get(hash);
    if (!record) return;
    await deps.refreshStore.revokeFamily(record.familyId, now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
    await deps.refreshStore.delete(hash);
  };
}
