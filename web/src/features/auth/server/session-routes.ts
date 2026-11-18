import {
  AccessTokenClaimsSchema,
  ApiErrorCode,
  OtpRequestBodySchema,
  type AccessTokenClaims,
  type TokenPairResponse,
} from '@panter/contracts';
import { decodeJwt } from 'jose';
import { NextResponse, type NextRequest } from 'next/server';
import { LOGIN_PATH, postLoginPath, safeNextPath } from '@/features/navigation/role-home';
import { isApiError } from '@/shared/api/errors';
import {
  SessionConsentBodySchema,
  SessionVerifyBodySchema,
  type SessionNavigation,
} from '../session-contract';
import { STAFF_ONLY_MESSAGE } from '../lib/messages';
import {
  crossSiteResponse,
  errorJson,
  fromApiFailure,
  isCrossSite,
  NO_STORE,
  readJson,
} from './bff-http';
import { applyConsentMark, consentPathFor, consentRequired } from './consent-gate';
import { clearSessionCookies, REFRESH_COOKIE, setSessionCookies } from './cookies';
import { isSessionRejected, type RefreshFn } from './session-call';
import { respondWithSession } from './session-handler';
import type { SessionApi } from './session-api';

/**
 * Route handlers de la sesión web (BFF). Hablan con panter-api de servidor a servidor y
 * guardan los tokens en cookies httpOnly; al navegador solo le devuelven datos de navegación.
 */
export interface SessionRouteDeps {
  api: SessionApi;
}

/** POST /api/session/otp/request → POST /auth/otp/request. */
export async function handleOtpRequest(
  request: NextRequest,
  deps: SessionRouteDeps,
): Promise<NextResponse> {
  const body = await readJson(request, OtpRequestBodySchema);
  if (!body.ok) return body.response;
  try {
    const result = await deps.api.requestOtp(body.data);
    return NextResponse.json(result, { status: 202, headers: NO_STORE });
  } catch (failure) {
    return fromApiFailure(failure);
  }
}

/** POST /api/session/otp/verify → POST /auth/otp/verify y cookies de sesión. */
export async function handleOtpVerify(
  request: NextRequest,
  deps: SessionRouteDeps,
): Promise<NextResponse> {
  const body = await readJson(request, SessionVerifyBodySchema);
  if (!body.ok) return body.response;

  let tokens;
  try {
    tokens = await deps.api.verifyOtp({ email: body.data.email, code: body.data.code });
  } catch (failure) {
    return fromApiFailure(failure);
  }

  const redirectTo = postLoginPath(tokens.user.roles, body.data.next);
  if (!redirectTo) {
    // Cuenta sin roles de personal: no se deja sesión abierta en la web.
    await deps.api.logout(tokens.refreshToken).catch(() => undefined);
    return errorJson(403, ApiErrorCode.FORBIDDEN, STAFF_ONLY_MESSAGE);
  }

  // Primer ingreso o aviso nuevo (HU-109): antes del panel, el aviso de privacidad. Si la API
  // todavía no envía `consent`, no se bloquea.
  const consent = tokens.user.consent;
  const navigation: SessionNavigation = {
    redirectTo: consentRequired(consent) ? consentPathFor(redirectTo) : redirectTo,
  };
  const response = NextResponse.json(navigation, { status: 200, headers: NO_STORE });
  setSessionCookies(response, tokens);
  applyConsentMark(response, tokens.user.id, consent);
  return response;
}

/** POST /api/session/logout → POST /auth/logout y borra las cookies, aunque la API falle. */
export async function handleLogout(
  request: NextRequest,
  deps: SessionRouteDeps,
): Promise<NextResponse> {
  if (isCrossSite(request)) return crossSiteResponse();
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) await deps.api.logout(refreshToken).catch(() => undefined);

  const navigation: SessionNavigation = { redirectTo: LOGIN_PATH };
  const response = NextResponse.json(navigation, { status: 200, headers: NO_STORE });
  clearSessionCookies(response);
  return response;
}

export interface RefreshRedirectDeps {
  refresh(refreshToken: string): Promise<TokenPairResponse>;
}

/**
 * GET /api/session/refresh?next=/ruta. Lo usan los Server Components cuando la API responde
 * 401 TOKEN_EXPIRED: un Server Component no puede escribir cookies, así que redirige aquí para
 * rotar el par de tokens (el mismo refresh del middleware) y volver a la página.
 */
export async function handleRefreshRedirect(
  request: NextRequest,
  deps: RefreshRedirectDeps,
): Promise<NextResponse> {
  const next = safeNextPath(request.nextUrl.searchParams.get('next')) ?? LOGIN_PATH;
  const loginUrl = new URL(LOGIN_PATH, request.url);
  if (next !== LOGIN_PATH) loginUrl.searchParams.set('next', next);

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    const response = NextResponse.redirect(loginUrl, 303);
    clearSessionCookies(response);
    return response;
  }

  try {
    const tokens = await deps.refresh(refreshToken);
    const response = NextResponse.redirect(new URL(next, request.url), 303);
    setSessionCookies(response, tokens);
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch (failure) {
    if (isApiError(failure) && isSessionRejected(failure)) {
      const response = NextResponse.redirect(loginUrl, 303);
      clearSessionCookies(response);
      return response;
    }
    // Falla temporal (red, API caída): no se borra la sesión ni se redirige en bucle.
    return new NextResponse(
      'No pudimos renovar tu sesión con PANTER. Intenta de nuevo en un momento.',
      { status: 503, headers: { ...NO_STORE, 'content-type': 'text/plain; charset=utf-8' } },
    );
  }
}

export interface ConsentRouteDeps {
  api: Pick<SessionApi, 'acceptConsent'>;
  refresh: RefreshFn;
}

/** Claims del token con el que se llamó a la API, solo para navegar y marcar la cookie. */
function claimsOf(accessToken: string): AccessTokenClaims | null {
  try {
    const parsed = AccessTokenClaimsSchema.safeParse(decodeJwt(accessToken));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/session/consent { version, accepted: true, next? } → POST /me/consent con Bearer.
 * Si la API lo registra, deja la marca de consentimiento y devuelve el panel de destino. Si la
 * versión ya no es la vigente, la API responde 409 CONSENT_VERSION_OUTDATED y la página recarga
 * el aviso.
 */
export async function handleConsent(
  request: NextRequest,
  deps: ConsentRouteDeps,
): Promise<NextResponse> {
  const body = await readJson(request, SessionConsentBodySchema);
  if (!body.ok) return body.response;
  const { next, ...accept } = body.data;

  return respondWithSession(
    request,
    deps.refresh,
    async (accessToken) => ({
      status: await deps.api.acceptConsent(accessToken, accept),
      claims: claimsOf(accessToken),
    }),
    ({ status, claims }) => {
      if (status.required) {
        return errorJson(
          409,
          ApiErrorCode.CONSENT_VERSION_OUTDATED,
          'El aviso de privacidad cambió. Revísalo de nuevo.',
        );
      }
      const navigation: SessionNavigation = {
        redirectTo: (claims && postLoginPath(claims.roles, next)) || LOGIN_PATH,
      };
      const response = NextResponse.json(navigation, { status: 200, headers: NO_STORE });
      if (claims) applyConsentMark(response, claims.sub, status);
      return response;
    },
  );
}
