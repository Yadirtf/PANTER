import type { AccessTokenClaims, ConsentStatus, TokenPairResponse } from '@panter/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import {
  CONSENT_PATH,
  decideAccess,
  FORBIDDEN_PATH,
  isPrivatePath,
  LOGIN_PATH,
  STAFF_ONLY_PATH,
  type AccessDecision,
  type AppPath,
} from '@/features/navigation/role-home';
import { isApiError } from '@/shared/api/errors';
import { verifyAccessToken, type AccessTokenKeys } from './access-token';
import { applyConsentMark, consentPathFor, consentRequired, hasConsentMark } from './consent-gate';
import {
  ACCESS_COOKIE,
  clearSessionCookies,
  clearConsentCookie,
  CONSENT_COOKIE,
  REFRESH_COOKIE,
  setSessionCookies,
} from './cookies';
import { createRefreshCoordinator, isSessionRejected } from './session-call';
import type { SessionApi } from './session-api';

export interface SessionMiddlewareDeps {
  api: Pick<SessionApi, 'refresh' | 'me'>;
  keys: AccessTokenKeys;
}

type SessionState =
  | { kind: 'none'; clearCookies: boolean }
  | {
      kind: 'valid';
      claims: AccessTokenClaims;
      accessToken: string;
      refreshed?: TokenPairResponse;
    };

/** Resultado de consultar el consentimiento: `known: false` si la API no respondió. */
type ConsentCheck = { known: true; consent: ConsentStatus | undefined } | { known: false };

/**
 * Lógica de middleware.ts (HU-107): verifica el access token de la cookie con el JWKS de la
 * API, lo refresca si venció y aplica la matriz de acceso por rol. También exige el
 * consentimiento de datos en las rutas privadas (HU-109, ver consent-gate.ts).
 */
export function createSessionMiddleware(deps: SessionMiddlewareDeps) {
  const refreshOnce = createRefreshCoordinator((token) => deps.api.refresh(token));

  async function resolveSession(request: NextRequest): Promise<SessionState> {
    const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

    if (accessToken) {
      const verified = await verifyAccessToken(accessToken, deps.keys);
      if (verified.status === 'valid') {
        return { kind: 'valid', claims: verified.claims, accessToken };
      }
      // Sin JWKS no se puede confiar en ningún token, ni siquiera en uno recién refrescado.
      if (verified.status === 'unavailable') return { kind: 'none', clearCookies: false };
    }
    if (!refreshToken) return { kind: 'none', clearCookies: Boolean(accessToken) };

    let tokens: TokenPairResponse;
    try {
      tokens = await refreshOnce(refreshToken);
    } catch (error) {
      const rejected = isApiError(error) && isSessionRejected(error);
      return { kind: 'none', clearCookies: rejected };
    }
    const verified = await verifyAccessToken(tokens.accessToken, deps.keys);
    if (verified.status !== 'valid') return { kind: 'none', clearCookies: false };
    return {
      kind: 'valid',
      claims: verified.claims,
      accessToken: tokens.accessToken,
      refreshed: tokens,
    };
  }

  /**
   * Estado del consentimiento sin marca en la cookie: lo trae la respuesta del refresh si la
   * hubo; si no, una sola llamada a GET /me. Si la API no responde no se bloquea (la API es la
   * autoridad y puede rechazar con CONSENT_REQUIRED) y se vuelve a intentar en la siguiente.
   */
  async function checkConsent(
    session: Extract<SessionState, { kind: 'valid' }>,
  ): Promise<ConsentCheck> {
    if (session.refreshed) return { known: true, consent: session.refreshed.user.consent };
    try {
      const me = await deps.api.me(session.accessToken);
      return { known: true, consent: me.consent };
    } catch {
      return { known: false };
    }
  }

  return async function sessionMiddleware(request: NextRequest): Promise<NextResponse> {
    const session = await resolveSession(request);
    const roles = session.kind === 'valid' ? session.claims.roles : null;
    const { pathname, search } = request.nextUrl;
    let decision: AccessDecision = decideAccess(pathname, search, roles);

    // Consentimiento (HU-109): solo para sesiones de personal a las que ya se les permitió entrar.
    let consentMark: ConsentCheck = { known: false };
    let dropConsentMark = false;
    if (session.kind === 'valid' && decision.kind === 'allow') {
      const marked = hasConsentMark(request.cookies.get(CONSENT_COOKIE)?.value, session.claims.sub);
      if (pathname === CONSENT_PATH) {
        // Se llega aquí también cuando la API respondió CONSENT_REQUIRED con una marca vieja:
        // se borra la marca (sin redirigir, para no entrar en bucle) y el aviso se muestra.
        dropConsentMark = marked;
      } else if (isPrivatePath(pathname) && !marked) {
        consentMark = await checkConsent(session);
        if (consentMark.known && consentRequired(consentMark.consent)) {
          decision = { kind: 'redirect', to: consentPathFor(`${pathname}${search}`) as AppPath };
        }
      }
    }

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

    if (session.kind === 'valid' && consentMark.known) {
      applyConsentMark(response, session.claims.sub, consentMark.consent);
    } else if (dropConsentMark) {
      clearConsentCookie(response);
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
