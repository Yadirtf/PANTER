import { ApiErrorCode, type TokenPairResponse } from '@panter/contracts';
import { ApiError, isApiError } from '@/shared/api/errors';

/** Respuestas de refresh que significan "la sesión ya no es válida": se borran las cookies. */
const SESSION_REJECTED = new Set<string>([
  ApiErrorCode.REFRESH_TOKEN_INVALID,
  ApiErrorCode.UNAUTHENTICATED,
  ApiErrorCode.TOKEN_EXPIRED,
  ApiErrorCode.ACCOUNT_SUSPENDED,
]);

export function isSessionRejected(error: ApiError): boolean {
  return SESSION_REJECTED.has(error.code);
}

export type RefreshFn = (refreshToken: string) => Promise<TokenPairResponse>;

/**
 * Cuánto se reutiliza el resultado de un refresh para el mismo refresh token. El refresh token
 * rota en cada uso, así que varias peticiones simultáneas del mismo navegador (prefetch de
 * enlaces, pestañas) no deben gastarlo dos veces dentro del mismo isolate.
 */
const REFRESH_REUSE_MS = 30 * 1000;
const REFRESH_CACHE_MAX = 500;

/** Envuelve `refresh` para que un mismo refresh token se use una sola vez por isolate. */
export function createRefreshCoordinator(refresh: RefreshFn): RefreshFn {
  const recent = new Map<string, { at: number; result: Promise<TokenPairResponse> }>();
  return function refreshOnce(refreshToken) {
    const now = Date.now();
    const cached = recent.get(refreshToken);
    if (cached && now - cached.at < REFRESH_REUSE_MS) return cached.result;

    for (const [token, entry] of recent) {
      if (now - entry.at >= REFRESH_REUSE_MS || recent.size >= REFRESH_CACHE_MAX) {
        recent.delete(token);
      }
    }
    const result = refresh(refreshToken);
    recent.set(refreshToken, { at: now, result });
    // Un fallo no se reutiliza: la siguiente petición vuelve a intentar.
    result.catch(() => recent.delete(refreshToken));
    return result;
  };
}

export interface SessionTokensIn {
  accessToken?: string;
  refreshToken?: string;
}

export interface SessionCallResult<T> {
  value: T;
  /** Par nuevo si hubo que refrescar: quien llama debe guardarlo en las cookies. */
  refreshed?: TokenPairResponse;
}

export function unauthenticatedError(): ApiError {
  return new ApiError({
    code: ApiErrorCode.UNAUTHENTICATED,
    message: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    status: 401,
  });
}

function isTokenExpired(error: unknown): boolean {
  return isApiError(error) && error.status === 401 && error.code === ApiErrorCode.TOKEN_EXPIRED;
}

/**
 * Llama a la API con el access token de la cookie (Bearer, de servidor a servidor). Si la API
 * responde 401 TOKEN_EXPIRED, o si solo queda el refresh token, refresca una vez con `refresh`
 * y repite la llamada. Con `refresh: null` (Server Components, que no pueden escribir cookies)
 * el error TOKEN_EXPIRED se propaga para que la página redirija a /api/session/refresh.
 */
export async function callWithSession<T>(
  tokens: SessionTokensIn,
  refresh: RefreshFn | null,
  call: (accessToken: string) => Promise<T>,
): Promise<SessionCallResult<T>> {
  if (tokens.accessToken) {
    try {
      return { value: await call(tokens.accessToken) };
    } catch (error) {
      if (!isTokenExpired(error) || !refresh || !tokens.refreshToken) throw error;
    }
  } else if (!refresh || !tokens.refreshToken) {
    throw unauthenticatedError();
  }

  const refreshed = await refresh(tokens.refreshToken!);
  return { value: await call(refreshed.accessToken), refreshed };
}
