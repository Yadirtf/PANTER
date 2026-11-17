import { ApiErrorCode, Role } from '@panter/contracts';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { STAFF_ONLY_MESSAGE } from '../lib/messages';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './cookies';
import { createSessionApi } from './session-api';
import { handleLogout, handleOtpRequest, handleOtpVerify } from './session-routes';
import {
  API_URL,
  apiError,
  createTestKeys,
  jsonResponse,
  setCookie,
  tokenPair,
  WEB_ORIGIN,
  type TestKeys,
} from './test-helpers';

let keys: TestKeys;
beforeAll(async () => {
  keys = await createTestKeys();
});

/** API simulada: responde según la ruta pedida. */
function mockApi(routes: Record<string, () => Response | Promise<Response>>) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    const handler = routes[path];
    if (!handler) throw new Error(`Ruta no simulada: ${path}`);
    return handler();
  });
  return { fetchMock, deps: { api: createSessionApi({ apiUrl: API_URL, fetch: fetchMock }) } };
}

function post(path: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(path, WEB_ORIGIN), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: new URL(WEB_ORIGIN).host,
      origin: WEB_ORIGIN,
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function sentBody(fetchMock: ReturnType<typeof mockApi>['fetchMock'], call = 0): unknown {
  return JSON.parse(String(fetchMock.mock.calls[call]![1]!.body));
}

describe('POST /api/session/otp/request', () => {
  it('pasa la solicitud a /auth/otp/request con el correo normalizado', async () => {
    const sent = { status: 'sent', expiresInSeconds: 300, resendAfterSeconds: 60 };
    const { fetchMock, deps } = mockApi({ '/auth/otp/request': () => jsonResponse(sent, 202) });

    const response = await handleOtpRequest(
      post('/api/session/otp/request', { email: '  Ana@Panter.CO ' }),
      deps,
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(sent);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${API_URL}/auth/otp/request`);
    expect(sentBody(fetchMock)).toEqual({ email: 'ana@panter.co' });
  });

  it('devuelve el error de la API con su código y estado', async () => {
    const { deps } = mockApi({
      '/auth/otp/request': () => apiError(429, ApiErrorCode.OTP_RATE_LIMITED, 'Demasiados'),
    });

    const response = await handleOtpRequest(
      post('/api/session/otp/request', { email: 'ana@panter.co' }),
      deps,
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: { code: ApiErrorCode.OTP_RATE_LIMITED, message: 'Demasiados' },
    });
  });

  it('valida el correo sin llamar a la API', async () => {
    const { fetchMock, deps } = mockApi({});
    const response = await handleOtpRequest(
      post('/api/session/otp/request', { email: 'no-es-correo' }),
      deps,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { origin: 'https://evil.com', 'sec-fetch-site': 'cross-site' },
    { origin: 'https://evil.com', 'sec-fetch-site': '' },
    { origin: WEB_ORIGIN, 'sec-fetch-site': 'same-site' },
  ])('rechaza peticiones de otro origen (%o)', async (headers) => {
    const { fetchMock, deps } = mockApi({});
    const response = await handleOtpRequest(
      post('/api/session/otp/request', { email: 'ana@panter.co' }, headers),
      deps,
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si la API no responde, devuelve 502 NETWORK_ERROR', async () => {
    const { deps } = mockApi({
      '/auth/otp/request': () => Promise.reject(new TypeError('fetch failed')),
    });
    const response = await handleOtpRequest(
      post('/api/session/otp/request', { email: 'ana@panter.co' }),
      deps,
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('NETWORK_ERROR');
  });
});

describe('POST /api/session/otp/verify', () => {
  it('guarda los tokens en cookies httpOnly y responde solo la navegación', async () => {
    const pair = await tokenPair(keys, [Role.DISPATCHER], 'rt-opaco-123');
    const { fetchMock, deps } = mockApi({ '/auth/otp/verify': () => jsonResponse(pair) });

    const response = await handleOtpVerify(
      post('/api/session/otp/verify', { email: 'ana@panter.co', code: '123456' }),
      deps,
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ redirectTo: '/despacho' });
    expect(text).not.toContain(pair.accessToken);
    expect(text).not.toContain(pair.refreshToken);
    expect(sentBody(fetchMock)).toEqual({ email: 'ana@panter.co', code: '123456' });

    expect(setCookie(response, ACCESS_COOKIE)).toEqual({
      value: pair.accessToken,
      path: '/',
      'max-age': String(pair.expiresIn),
      expires: expect.any(String),
      secure: 'true',
      httponly: 'true',
      samesite: 'lax',
    });
    expect(setCookie(response, REFRESH_COOKIE)).toEqual({
      value: 'rt-opaco-123',
      path: '/',
      'max-age': String(pair.refreshExpiresIn),
      expires: expect.any(String),
      secure: 'true',
      httponly: 'true',
      samesite: 'lax',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('respeta next si el rol puede entrar; si no, usa el panel del rol', async () => {
    const admin = await tokenPair(keys, [Role.ADMIN]);
    const operador = await tokenPair(keys, [Role.TOUR_OPERATOR]);
    const pairs = [admin, operador];
    const { deps } = mockApi({ '/auth/otp/verify': () => jsonResponse(pairs.shift()) });
    const body = { email: 'ana@panter.co', code: '123456', next: '/despacho/alertas' };

    const first = await handleOtpVerify(post('/api/session/otp/verify', body), deps);
    const second = await handleOtpVerify(post('/api/session/otp/verify', body), deps);

    expect(await first.json()).toEqual({ redirectTo: '/despacho/alertas' });
    expect(await second.json()).toEqual({ redirectTo: '/operador' });
  });

  it.each([
    [400, ApiErrorCode.OTP_INVALID],
    [400, ApiErrorCode.OTP_EXPIRED],
    [429, ApiErrorCode.OTP_TOO_MANY_ATTEMPTS],
    [403, ApiErrorCode.ACCOUNT_SUSPENDED],
  ])('propaga %i %s sin crear cookies', async (status, code) => {
    const { deps } = mockApi({ '/auth/otp/verify': () => apiError(status, code) });

    const response = await handleOtpVerify(
      post('/api/session/otp/verify', { email: 'ana@panter.co', code: '000000' }),
      deps,
    );

    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('una cuenta sin roles de personal no abre sesión: revoca el refresh y responde 403', async () => {
    const pair = await tokenPair(keys, [Role.PASSENGER, Role.DRIVER], 'rt-pasajero');
    const { fetchMock, deps } = mockApi({
      '/auth/otp/verify': () => jsonResponse(pair),
      '/auth/logout': () => new Response(null, { status: 204 }),
    });

    const response = await handleOtpVerify(
      post('/api/session/otp/verify', { email: 'ana@panter.co', code: '123456' }),
      deps,
    );

    expect(response.status).toBe(403);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: ApiErrorCode.FORBIDDEN, message: STAFF_ONLY_MESSAGE },
    });
    expect(text).not.toContain(pair.accessToken);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(String(fetchMock.mock.calls[1]![0])).toBe(`${API_URL}/auth/logout`);
    expect(sentBody(fetchMock, 1)).toEqual({ refreshToken: 'rt-pasajero' });
  });

  it('valida el código antes de llamar a la API', async () => {
    const { fetchMock, deps } = mockApi({});
    const response = await handleOtpVerify(
      post('/api/session/otp/verify', { email: 'ana@panter.co', code: '12ab' }),
      deps,
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si la API responde algo fuera del contrato, no crea sesión', async () => {
    const { deps } = mockApi({ '/auth/otp/verify': () => jsonResponse({ accessToken: 'x' }) });
    const response = await handleOtpVerify(
      post('/api/session/otp/verify', { email: 'ana@panter.co', code: '123456' }),
      deps,
    );
    expect(response.status).toBe(502);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe('POST /api/session/logout', () => {
  function logoutRequest(cookies: string) {
    return post('/api/session/logout', undefined, { cookie: cookies });
  }

  it('revoca el refresh token en la API y borra las dos cookies', async () => {
    const { fetchMock, deps } = mockApi({
      '/auth/logout': () => new Response(null, { status: 204 }),
    });

    const response = await handleLogout(
      logoutRequest(`${ACCESS_COOKIE}=at; ${REFRESH_COOKIE}=rt-activo`),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redirectTo: '/login' });
    expect(sentBody(fetchMock)).toEqual({ refreshToken: 'rt-activo' });
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
      expect(setCookie(response, name)).toMatchObject({
        value: '',
        'max-age': '0',
        path: '/',
        httponly: 'true',
        secure: 'true',
      });
    }
  });

  it('borra las cookies aunque la API falle', async () => {
    const { deps } = mockApi({
      '/auth/logout': () => apiError(500, ApiErrorCode.INTERNAL_ERROR),
    });
    const response = await handleLogout(logoutRequest(`${REFRESH_COOKIE}=rt`), deps);
    expect(response.status).toBe(200);
    expect(setCookie(response, REFRESH_COOKIE)?.['max-age']).toBe('0');
  });

  it('sin refresh token no llama a la API', async () => {
    const { fetchMock, deps } = mockApi({});
    const response = await handleLogout(logoutRequest(''), deps);
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
