import { ApiErrorCode, OtpRequestBodySchema, type TokenPairResponse } from '@panter/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { LOGIN_PATH, postLoginPath, safeNextPath } from '@/features/navigation/role-home';
import { isApiError } from '@/shared/api/errors';
import { SessionVerifyBodySchema, type SessionNavigation } from '../session-contract';
import { STAFF_ONLY_MESSAGE } from '../lib/messages';
import {
  crossSiteResponse,
  errorJson,
  fromApiFailure,
  isCrossSite,
  NO_STORE,
  readJson,
} from './bff-http';
import { clearSessionCookies, REFRESH_COOKIE, setSessionCookies } from './cookies';
import { isSessionRejected } from './session-call';
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

  const navigation: SessionNavigation = { redirectTo };
  const response = NextResponse.json(navigation, { status: 200, headers: NO_STORE });
  setSessionCookies(response, tokens);
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
