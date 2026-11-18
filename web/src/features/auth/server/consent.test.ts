import {
  ApiErrorCode,
  PRIVACY_POLICY_VERSION,
  REFRESH_TOKEN_TTL_SECONDS,
  Role,
  type ConsentStatus,
  type MeResponse,
  type TokenPairResponse,
} from '@panter/contracts';
import type { FetchImplementation } from 'jose';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError, ClientErrorCode } from '@/shared/api/errors';
import { consentFailureAction } from '../lib/consent';
import { CONSENT_UPDATED_MESSAGE, consentErrorMessage } from '../lib/messages';
import { createApiJwks } from './access-token';
import { CONSENT_UNKNOWN_TTL_SECONDS, consentCookieValue, hasConsentMark } from './consent-gate';
import { ACCESS_COOKIE, CONSENT_COOKIE, REFRESH_COOKIE } from './cookies';
import { createSessionApi } from './session-api';
import { createSessionMiddleware } from './session-middleware';
import { handleConsent, handleLogout, handleOtpVerify } from './session-routes';
import {
  API_URL,
  apiError,
  createTestKeys,
  jsonResponse,
  pageRequest,
  setCookie,
  signAccessToken,
  tokenPair,
  USER_ID,
  WEB_ORIGIN,
  type TestKeys,
} from './test-helpers';

let keys: TestKeys;
beforeAll(async () => {
  keys = await createTestKeys();
});

const OTHER_SUB = '7b1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

function consent(required: boolean): ConsentStatus {
  return {
    currentVersion: PRIVACY_POLICY_VERSION,
    acceptedVersion: required ? null : PRIVACY_POLICY_VERSION,
    acceptedAt: required ? null : '2026-11-18T15:00:00.000Z',
    required,
  };
}

async function pairWith(
  roles: Role[],
  status: ConsentStatus | undefined,
  refreshToken = 'rt-nuevo',
): Promise<TokenPairResponse> {
  const pair = await tokenPair(keys, roles, refreshToken);
  return { ...pair, user: { ...pair.user, ...(status ? { consent: status } : {}) } };
}

function post(path: string, body: unknown, cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return new NextRequest(new URL(path, WEB_ORIGIN), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: new URL(WEB_ORIGIN).host,
      origin: WEB_ORIGIN,
      'sec-fetch-site': 'same-origin',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('login (verify): consentimiento en el primer ingreso', () => {
  async function verify(status: ConsentStatus | undefined, next?: string) {
    const pair = await pairWith([Role.ADMIN], status);
    const api = createSessionApi({
      apiUrl: API_URL,
      fetch: vi.fn<typeof fetch>(async () => jsonResponse(pair)),
    });
    const response = await handleOtpVerify(
      post('/api/session/otp/verify', { email: 'a@panter.test', code: '123456', next }),
      { api },
    );
    return { response, pair, body: await response.json() };
  }

  it('si consent.required es true lleva a /consentimiento con el destino en next', async () => {
    const { response, body, pair } = await verify(consent(true), '/admin/usuarios');
    expect(response.status).toBe(200);
    expect(body).toEqual({ redirectTo: '/consentimiento?next=%2Fadmin%2Fusuarios' });
    // La sesión queda abierta (para poder aceptar), pero sin marca de consentimiento.
    expect(setCookie(response, ACCESS_COOKIE)?.value).toBe(pair.accessToken);
    expect(setCookie(response, CONSENT_COOKIE)?.['max-age']).toBe('0');
  });

  it('si ya aceptó la versión vigente va al panel y deja la marca larga', async () => {
    const { response, body } = await verify(consent(false));
    expect(body).toEqual({ redirectTo: '/admin' });
    expect(setCookie(response, CONSENT_COOKIE)).toMatchObject({
      value: consentCookieValue(USER_ID),
      'max-age': String(REFRESH_TOKEN_TTL_SECONDS),
      httponly: 'true',
      secure: 'true',
      path: '/',
    });
  });

  it('si la API todavía no envía consent no bloquea (marca corta)', async () => {
    const { response, body } = await verify(undefined);
    expect(body).toEqual({ redirectTo: '/admin' });
    expect(setCookie(response, CONSENT_COOKIE)?.['max-age']).toBe(
      String(CONSENT_UNKNOWN_TTL_SECONDS),
    );
  });
});

describe('middleware: exige consentimiento en las rutas privadas', () => {
  function setup(me: () => Promise<MeResponse>, refresh?: () => Promise<TokenPairResponse>) {
    const meMock = vi.fn(me);
    const refreshMock = vi.fn(refresh ?? (() => Promise.reject(new Error('no esperado'))));
    const fetchJwks = vi.fn<FetchImplementation>(async () => jsonResponse(keys.jwks));
    const middleware = createSessionMiddleware({
      api: { me: meMock, refresh: refreshMock },
      keys: createApiJwks(API_URL, fetchJwks),
    });
    return { middleware, me: meMock, refresh: refreshMock };
  }
  const meWith = async (status: ConsentStatus | undefined) =>
    (await pairWith([Role.ADMIN], status)).user;

  it('sin marca consulta GET /me una vez y, si falta aceptar, lleva a /consentimiento', async () => {
    const { middleware, me } = setup(() => meWith(consent(true)));
    const token = await signAccessToken(keys, { roles: [Role.ADMIN] });

    const response = await middleware(
      pageRequest('/admin/usuarios?q=ana', { [ACCESS_COOKIE]: token }),
    );

    expect(me).toHaveBeenCalledWith(token);
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/consentimiento');
    expect(location.searchParams.get('next')).toBe('/admin/usuarios?q=ana');
    expect(setCookie(response, CONSENT_COOKIE)?.['max-age']).toBe('0');
  });

  it('si ya aceptó deja pasar y guarda la marca: la siguiente petición no llama a la API', async () => {
    const { middleware, me } = setup(() => meWith(consent(false)));
    const token = await signAccessToken(keys, { roles: [Role.DISPATCHER] });

    const first = await middleware(pageRequest('/despacho', { [ACCESS_COOKIE]: token }));
    expect(first.headers.get('x-middleware-next')).toBe('1');
    const mark = setCookie(first, CONSENT_COOKIE)!;
    expect(mark.value).toBe(`${USER_ID}.${PRIVACY_POLICY_VERSION}`);

    const second = await middleware(
      pageRequest('/despacho/alertas', { [ACCESS_COOKIE]: token, [CONSENT_COOKIE]: mark.value! }),
    );
    expect(second.headers.get('x-middleware-next')).toBe('1');
    expect(me).toHaveBeenCalledTimes(1);
  });

  it('una marca de otro usuario o de una versión anterior no sirve', async () => {
    const { middleware, me } = setup(() => meWith(consent(true)));
    const token = await signAccessToken(keys, { roles: [Role.ADMIN] });
    for (const mark of [consentCookieValue(OTHER_SUB), `${USER_ID}.2025-01-v0`]) {
      const response = await middleware(
        pageRequest('/admin', { [ACCESS_COOKIE]: token, [CONSENT_COOKIE]: mark }),
      );
      expect(new URL(response.headers.get('location')!).pathname).toBe('/consentimiento');
    }
    expect(me).toHaveBeenCalledTimes(2);
    expect(hasConsentMark(undefined, USER_ID)).toBe(false);
  });

  it('si la API aún no envía consent no bloquea (marca corta)', async () => {
    const { middleware } = setup(() => meWith(undefined));
    const token = await signAccessToken(keys, { roles: [Role.ADMIN] });
    const response = await middleware(pageRequest('/admin', { [ACCESS_COOKIE]: token }));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(setCookie(response, CONSENT_COOKIE)?.['max-age']).toBe(
      String(CONSENT_UNKNOWN_TTL_SECONDS),
    );
  });

  it('si GET /me falla deja pasar sin marca (la API es la autoridad)', async () => {
    const { middleware } = setup(() =>
      Promise.reject(new ApiError({ code: ClientErrorCode.NETWORK_ERROR, message: 'x' })),
    );
    const token = await signAccessToken(keys, { roles: [Role.ADMIN] });
    const response = await middleware(pageRequest('/admin', { [ACCESS_COOKIE]: token }));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(setCookie(response, CONSENT_COOKIE)).toBeUndefined();
  });

  it('tras un refresh usa el consent de la respuesta, sin llamar a GET /me', async () => {
    const pair = await pairWith([Role.ADMIN], consent(true), 'rt-rotado');
    const { middleware, me } = setup(
      () => meWith(consent(false)),
      () => Promise.resolve(pair),
    );
    const response = await middleware(pageRequest('/admin', { [REFRESH_COOKIE]: 'rt-viejo' }));
    expect(me).not.toHaveBeenCalled();
    expect(new URL(response.headers.get('location')!).pathname).toBe('/consentimiento');
    expect(setCookie(response, REFRESH_COOKIE)?.value).toBe('rt-rotado');
  });

  it('/consentimiento exige sesión de personal', async () => {
    const { middleware } = setup(() => meWith(undefined));

    const anonymous = await middleware(pageRequest('/consentimiento?next=%2Fadmin'));
    const login = new URL(anonymous.headers.get('location')!);
    expect(login.pathname).toBe('/login');
    expect(login.searchParams.get('next')).toBe('/consentimiento?next=%2Fadmin');

    const passenger = await signAccessToken(keys, { roles: [Role.PASSENGER] });
    const staffOnly = await middleware(
      pageRequest('/consentimiento', { [ACCESS_COOKIE]: passenger }),
    );
    expect(staffOnly.status).toBe(403);
  });

  it('/consentimiento se muestra y borra una marca vieja (sin bucles con CONSENT_REQUIRED)', async () => {
    const { middleware, me } = setup(() => meWith(consent(false)));
    const token = await signAccessToken(keys, { roles: [Role.ADMIN] });
    const response = await middleware(
      pageRequest('/consentimiento?next=%2Fadmin', {
        [ACCESS_COOKIE]: token,
        [CONSENT_COOKIE]: consentCookieValue(USER_ID),
      }),
    );
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(setCookie(response, CONSENT_COOKIE)?.['max-age']).toBe('0');
    expect(me).not.toHaveBeenCalled();
  });
});

describe('POST /api/session/consent', () => {
  type Handler = (request: Request) => Response | Promise<Response>;
  function mockApi(handlers: Handler[]) {
    let n = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(`${init?.method} ${url.pathname}`).toBe('POST /me/consent');
      return handlers[Math.min(n++, handlers.length - 1)]!(new Request(url, init));
    });
    const refresh = vi.fn<(token: string) => Promise<TokenPairResponse>>(() =>
      Promise.reject(new Error('no esperado')),
    );
    return {
      fetchMock,
      refresh,
      deps: { api: createSessionApi({ apiUrl: API_URL, fetch: fetchMock }), refresh },
    };
  }
  const accept = { version: PRIVACY_POLICY_VERSION, accepted: true };

  it('envía { version, accepted: true } con Bearer y vuelve al destino con la marca', async () => {
    const token = await signAccessToken(keys, { roles: [Role.ADMIN] });
    const { fetchMock, deps } = mockApi([() => jsonResponse(consent(false))]);

    const response = await handleConsent(
      post(
        '/api/session/consent',
        { ...accept, next: '/admin/usuarios' },
        {
          [ACCESS_COOKIE]: token,
          [REFRESH_COOKIE]: 'rt',
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ redirectTo: '/admin/usuarios' });
    expect(text).not.toContain(token);
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(String(init.body))).toEqual(accept);
    expect(setCookie(response, CONSENT_COOKIE)?.value).toBe(consentCookieValue(USER_ID));
  });

  it('sin next válido vuelve al panel del rol', async () => {
    const token = await signAccessToken(keys, { roles: [Role.TOUR_OPERATOR] });
    const { deps } = mockApi([() => jsonResponse(consent(false))]);
    const response = await handleConsent(
      post(
        '/api/session/consent',
        { ...accept, next: '//malo.example' },
        { [ACCESS_COOKIE]: token },
      ),
      deps,
    );
    expect(await response.json()).toEqual({ redirectTo: '/operador' });
  });

  it('pasa 409 CONSENT_VERSION_OUTDATED para que la página recargue el aviso', async () => {
    const token = await signAccessToken(keys, { roles: [Role.ADMIN] });
    const { deps } = mockApi([() => apiError(409, ApiErrorCode.CONSENT_VERSION_OUTDATED)]);
    const response = await handleConsent(
      post('/api/session/consent', accept, { [ACCESS_COOKIE]: token }),
      deps,
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe(ApiErrorCode.CONSENT_VERSION_OUTDATED);
    expect(setCookie(response, CONSENT_COOKIE)).toBeUndefined();
  });

  it('con 401 TOKEN_EXPIRED refresca y repite', async () => {
    const fresh = await pairWith([Role.ADMIN], consent(true), 'rt-rotado');
    const { fetchMock, refresh, deps } = mockApi([
      () => apiError(401, ApiErrorCode.TOKEN_EXPIRED),
      () => jsonResponse(consent(false)),
    ]);
    refresh.mockResolvedValue(fresh);

    const response = await handleConsent(
      post('/api/session/consent', accept, { [ACCESS_COOKIE]: 'at-viejo', [REFRESH_COOKIE]: 'rt' }),
      deps,
    );

    expect(response.status).toBe(200);
    const auth = (call: number) =>
      (fetchMock.mock.calls[call]![1]!.headers as Record<string, string>).authorization;
    expect(auth(0)).toBe('Bearer at-viejo');
    expect(auth(1)).toBe(`Bearer ${fresh.accessToken}`);
    expect(setCookie(response, REFRESH_COOKIE)?.value).toBe('rt-rotado');
    expect(setCookie(response, CONSENT_COOKIE)?.value).toBe(consentCookieValue(USER_ID));
  });

  it('rechaza un cuerpo sin aceptación explícita sin llamar a la API', async () => {
    const { fetchMock, deps } = mockApi([]);
    const response = await handleConsent(
      post(
        '/api/session/consent',
        { version: PRIVACY_POLICY_VERSION, accepted: false },
        {
          [ACCESS_COOKIE]: 'at',
        },
      ),
      deps,
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('"No acepto" cierra la sesión: logout también borra la marca', async () => {
    const api = createSessionApi({
      apiUrl: API_URL,
      fetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 204 })),
    });
    const response = await handleLogout(
      post('/api/session/logout', {}, { [REFRESH_COOKIE]: 'rt' }),
      { api },
    );
    expect(await response.json()).toEqual({ redirectTo: '/login' });
    expect(setCookie(response, CONSENT_COOKIE)?.['max-age']).toBe('0');
  });
});

describe('/consentimiento: qué hacer si "Acepto" falla', () => {
  const here = `${WEB_ORIGIN}/consentimiento?next=%2Fadmin`;

  it('con CONSENT_VERSION_OUTDATED recarga el aviso marcando que cambió', () => {
    const action = consentFailureAction(ApiErrorCode.CONSENT_VERSION_OUTDATED, here);
    expect(action).toEqual({
      kind: 'navigate',
      to: `${WEB_ORIGIN}/consentimiento?next=%2Fadmin&actualizado=1`,
    });
    expect(consentErrorMessage(ApiErrorCode.CONSENT_VERSION_OUTDATED)).toBe(
      CONSENT_UPDATED_MESSAGE,
    );
  });

  it('con la sesión vencida va al login; otros errores muestran un mensaje', () => {
    expect(consentFailureAction(ApiErrorCode.UNAUTHENTICATED, here)).toEqual({
      kind: 'navigate',
      to: '/login',
    });
    expect(consentFailureAction(ClientErrorCode.NETWORK_ERROR, here)).toEqual({
      kind: 'message',
      message: expect.stringMatching(/No pudimos conectar/),
    });
  });
});
