import type { NextRequest, NextResponse } from 'next/server';
import { isApiError } from '@/shared/api/errors';
import { errorJson, fromApiFailure } from './bff-http';
import { ACCESS_COOKIE, clearSessionCookies, REFRESH_COOKIE, setSessionCookies } from './cookies';
import { callWithSession, isSessionRejected, type RefreshFn } from './session-call';

/**
 * Ejecuta una llamada autenticada desde un route handler BFF: toma los tokens de las cookies,
 * refresca si la API responde TOKEN_EXPIRED y guarda el par nuevo en la respuesta. Si la sesión
 * ya no es válida responde 401 y borra las cookies.
 */
export async function respondWithSession<T>(
  request: NextRequest,
  refresh: RefreshFn,
  call: (accessToken: string) => Promise<T>,
  onSuccess: (value: T) => NextResponse,
): Promise<NextResponse> {
  const tokens = {
    accessToken: request.cookies.get(ACCESS_COOKIE)?.value,
    refreshToken: request.cookies.get(REFRESH_COOKIE)?.value,
  };
  try {
    const { value, refreshed } = await callWithSession(tokens, refresh, call);
    const response = onSuccess(value);
    if (refreshed) setSessionCookies(response, refreshed);
    return response;
  } catch (failure) {
    if (isApiError(failure) && isSessionRejected(failure)) {
      const status = failure.status >= 400 ? failure.status : 401;
      const response = errorJson(status, failure.code, failure.message);
      clearSessionCookies(response);
      return response;
    }
    return fromApiFailure(failure);
  }
}
