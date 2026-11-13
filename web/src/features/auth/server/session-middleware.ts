import { ApiErrorCode, type AccessTokenClaims, type TokenPairResponse } from '@panter/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import {
  decideAccess,
  FORBIDDEN_PATH,
  LOGIN_PATH,
  STAFF_ONLY_PATH,
} from '@/features/navigation/role-home';
import { isApiError } from '@/shared/api/errors';
import { verifyAccessToken, type AccessTokenKeys } from './access-token';
import { ACCESS_COOKIE, clearSessionCookies, REFRESH_COOKIE, setSessionCookies } from './cookies';
import type { SessionApi } from './session-api';

export interface SessionMiddlewareDeps {
  api: Pick<SessionApi, 'refresh'>;
  keys: AccessTokenKeys;
}

/** Respuestas de refresh que significan "la sesión ya no es válida": se borran las cookies. */
const SESSION_REJECTED = new Set<string>([
  ApiErrorCode.REFRESH_TOKEN_INVALID,
  ApiErrorCode.UNAUTHENTICATED,
  ApiErrorCode.TOKEN_EXPIRED,
  ApiErrorCode.ACCOUNT_SUSPENDED,
]);

/**
 * Cuánto se reutiliza el resultado de un refresh para el mismo refresh token. El refresh token
 * rota en cada uso, así que varias peticiones simultáneas del mismo navegador (prefetch de
 * enlaces, pestañas) no deben gastarlo dos veces dentro del mismo isolate.
 */
const REFRESH_REUSE_MS = 30 * 1000;
const REFRESH_CACHE_MAX = 500;

type SessionState =
  | { kind: 'none'; clearCookies: boolean }
  | { kind: 'valid'; claims: AccessTokenClaims; refreshed?: TokenPairResponse };

/**
 * Lógica de middleware.ts (HU-107): verifica el access token de la cookie con el JWKS de la
 * API, lo refresca si venció y aplica la matriz de acceso por rol.
 */
export function createSessionMiddleware(deps: SessionMiddlewareDeps) {
  const recentRefreshes = new Map<string, { at: number; result: Promise<TokenPairResponse> }>();

  function refreshOnce(refreshToken: string): Promise<TokenPairResponse> {
    const now = Date.now();
    const cached = recentRefreshes.get(refreshToken);
    if (cached && now - cached.at < REFRESH_REUSE_MS) return cached.result;

    for (const [token, entry] of recentRefreshes) {
      if (now - entry.at >= REFRESH_REUSE_MS || recentRefreshes.size >= REFRESH_CACHE_MAX) {
        recentRefreshes.delete(token);
      }
    }
    const result = deps.api.refresh(refreshToken);
    recentRefreshes.set(refreshToken, { at: now, result });
    // Un fallo no se reutiliza: la siguiente petición vuelve a intentar.
    result.catch(() => recentRefreshes.delete(refreshToken));
    return result;
  }

  async function resolveSession(request: NextRequest): Promise<SessionState> {
    const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

    if (accessToken) {
      const verified = await verifyAccessToken(accessToken, deps.keys);
      if (verified.status === 'valid') return { kind: 'valid', claims: verified.claims };
      // Sin JWKS no se puede confiar en ningún token, ni siquiera en uno recién refrescado.
      if (verified.status === 'unavailable') return { kind: 'none', clearCookies: false };
    }
    if (!refreshToken) return { kind: 'none', clearCookies: Boolean(accessToken) };

    let tokens: TokenPairResponse;
    try {
      tokens = await refreshOnce(refreshToken);
    } catch (error) {
      const rejected = isApiError(error) && SESSION_REJECTED.has(error.code);
      return { kind: 'none', clearCookies: rejected };
    }
    const verified = await verifyAccessToken(tokens.accessToken, deps.keys);
    if (verified.status !== 'valid') return { kind: 'none', clearCookies: false };
    return { kind: 'valid', claims: verified.claims, refreshed: tokens };
  }

  return async function sessionMiddleware(request: NextRequest): Promise<NextResponse> {
    const session = await resolveSession(request);
    const roles = session.kind === 'valid' ? session.claims.roles : null;
    const { pathname, search } = request.nextUrl;
    const decision = decideAccess(pathname, search, roles);

    let response: NextResponse;
    switch (decision.kind) {
      case 'allow': {
        if (session.kind === 'valid' && session.refreshed) {
          // Las páginas de esta misma petición ya leen el token nuevo.
          request.cookies.set(ACCESS_COOKIE, session.refreshed.accessToken);
          request.cookies.set(REFRESH_COOKIE, session.refreshed.refreshToken);
          response = NextResponse.next({ request: { headers: new Headers(request.headers) } });
        } else {
          response = NextResponse.next();
        }
        break;
      }
      case 'login': {
        const url = new URL(LOGIN_PATH, request.url);
        url.searchParams.set('next', decision.next);
        response = NextResponse.redirect(url);
        break;
      }
      case 'redirect':
        response = NextResponse.redirect(new URL(decision.to, request.url));
        break;
      case 'forbidden':
        response = NextResponse.rewrite(new URL(FORBIDDEN_PATH, request.url), { status: 403 });
        break;
      case 'staff-only':
        response = NextResponse.rewrite(new URL(STAFF_ONLY_PATH, request.url), { status: 403 });
        break;
    }

    if (session.kind === 'valid' && session.refreshed) {
      setSessionCookies(response, session.refreshed);
    } else if (session.kind === 'none' && session.clearCookies) {
      clearSessionCookies(response);
    }
    // Las páginas con sesión no se guardan en cachés compartidas.
    response.headers.set('cache-control', 'private, no-store');
    return response;
  };
}
