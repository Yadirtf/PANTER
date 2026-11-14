import { ApiErrorCode, OtpRequestBodySchema, type ApiErrorBody } from '@panter/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import { LOGIN_PATH, postLoginPath } from '@/features/navigation/role-home';
import { ClientErrorCode, toApiError } from '@/shared/api/errors';
import { SessionVerifyBodySchema, type SessionNavigation } from '../session-contract';
import { STAFF_ONLY_MESSAGE } from '../lib/messages';
import { clearSessionCookies, REFRESH_COOKIE, setSessionCookies } from './cookies';
import type { SessionApi } from './session-api';

/**
 * Route handlers de la sesión web (BFF). Hablan con panter-api de servidor a servidor y
 * guardan los tokens en cookies httpOnly; al navegador solo le devuelven datos de navegación.
 */
export interface SessionRouteDeps {
  api: SessionApi;
}

const NO_STORE = { 'cache-control': 'no-store' };

function errorResponse(status: number, body: ApiErrorBody): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function error(status: number, code: string, message: string, details?: unknown): NextResponse {
  return errorResponse(status, { error: { code, message, ...(details ? { details } : {}) } });
}

/** Convierte un fallo de la API en la misma respuesta de error para el navegador. */
function fromApiFailure(value: unknown): NextResponse {
  const apiError = toApiError(value);
  if (apiError.status === 0 || apiError.code === ClientErrorCode.INVALID_RESPONSE) {
    return error(
      502,
      ClientErrorCode.NETWORK_ERROR,
      'No pudimos conectar con PANTER. Intenta de nuevo en un momento.',
    );
  }
  const status = apiError.status >= 400 ? apiError.status : 502;
  return error(status, apiError.code, apiError.message, apiError.details);
}

/**
 * Rechaza peticiones de otros orígenes (las cookies ya son SameSite=Lax; esto es una capa más).
 * Se compara contra el encabezado Host y no contra `request.url`, que en el Worker de OpenNext
 * no siempre conserva el host público.
 */
function isCrossSite(request: NextRequest): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return true;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('host');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

async function readJson<S extends z.ZodType>(
  request: NextRequest,
  schema: S,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: NextResponse }> {
  if (isCrossSite(request)) {
    return { ok: false, response: error(403, ApiErrorCode.FORBIDDEN, 'Origen no permitido.') };
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: error(400, ApiErrorCode.VALIDATION_ERROR, 'Revisa los datos e intenta de nuevo.', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      }),
    };
  }
  return { ok: true, data: parsed.data };
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
    return error(403, ApiErrorCode.FORBIDDEN, STAFF_ONLY_MESSAGE);
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
  if (isCrossSite(request)) return error(403, ApiErrorCode.FORBIDDEN, 'Origen no permitido.');
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) await deps.api.logout(refreshToken).catch(() => undefined);

  const navigation: SessionNavigation = { redirectTo: LOGIN_PATH };
  const response = NextResponse.json(navigation, { status: 200, headers: NO_STORE });
  clearSessionCookies(response);
  return response;
}
