import { ApiErrorCode, Role, type TokenPairResponse } from '@panter/contracts';
import type { FetchImplementation } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError, ClientErrorCode } from '@/shared/api/errors';
import { createApiJwks, verifyAccessToken } from './access-token';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './cookies';
import { createSessionMiddleware } from './session-middleware';
import {
  API_URL,
  createTestKeys,
  jsonResponse,
  pageRequest,
  setCookie,
  signAccessToken,
  tokenPair,
  WEB_ORIGIN,
  type TestKeys,
} from './test-helpers';

let keys: TestKeys;
let otherKeys: TestKeys;

beforeAll(async () => {
  keys = await createTestKeys();
  otherKeys = await createTestKeys('otra-llave');
});

/** JWKS simulado de panter-api servido por un fetch falso. */
function jwksFetch(response: () => Response = () => jsonResponse(keys.jwks)) {
  return vi.fn<FetchImplementation>(() => Promise.resolve(response()));
}

function setup(
  options: {
    refresh?: (token: string) => Promise<TokenPairResponse>;
    jwks?: ReturnType<typeof jwksFetch>;
  } = {},
) {
  const fetchJwks = options.jwks ?? jwksFetch();
  const refresh = vi.fn<(token: string) => Promise<TokenPairResponse>>(
    options.refresh ?? (() => Promise.reject(new Error('refresh no esperado'))),
  );
  const middleware = createSessionMiddleware({
    api: { refresh },
    keys: createApiJwks(API_URL, fetchJwks),
  });
  return { middleware, refresh, fetchJwks };
}

const isNext = (response: Response) => response.headers.get('x-middleware-next') === '1';
const rewrittenTo = (response: Response) => {
  const rewrite = response.headers.get('x-middleware-rewrite');
  return rewrite ? new URL(rewrite).pathname : null;
};

describe('verifyAccessToken', () => {
  it('acepta un token RS256 válido y devuelve sus claims', async () => {
    const token = await signAccessToken(keys, { roles: [Role.DISPATCHER] });
    const result = await verifyAccessToken(token, createApiJwks(API_URL, jwksFetch()));
    expect(result).toMatchObject({ status: 'valid', claims: { roles: [Role.DISPATCHER] } });
  });

  it('distingue vencido, inválido y JWKS no disponible', async () => {
    const jwks = createApiJwks(API_URL, jwksFetch());
    const expired = await signAccessToken(keys, { expiresIn: -120 });
    const wrongIssuer = await signAccessToken(keys, { issuer: 'otro' });
    const wrongAudience = await signAccessToken(keys, { audience: 'otra-app' });
    const wrongKey = await signAccessToken(otherKeys, { kid: keys.kid });
    const badSub = await signAccessToken(keys, { sub: 'no-es-uuid' });

    expect(await verifyAccessToken(expired, jwks)).toEqual({ status: 'expired' });
    expect(await verifyAccessToken(wrongIssuer, jwks)).toEqual({ status: 'invalid' });
    expect(await verifyAccessToken(wrongAudience, jwks)).toEqual({ status: 'invalid' });
    expect(await verifyAccessToken(wrongKey, jwks)).toEqual({ status: 'invalid' });
    expect(await verifyAccessToken(badSub, jwks)).toEqual({ status: 'invalid' });
    expect(await verifyAccessToken('no.es.jwt', jwks)).toEqual({ status: 'invalid' });

    const down = createApiJwks(
      API_URL,
      jwksFetch(() => new Response('caído', { status: 503 })),
    );
    const valid = await signAccessToken(keys);
    expect(await verifyAccessToken(valid, down)).toEqual({ status: 'unavailable' });
  });

  it('pide el JWKS a /.well-known/jwks.json de la API y lo guarda en caché', async () => {
    const fetchJwks = jwksFetch();
    const jwks = createApiJwks(API_URL, fetchJwks);
    const token = await signAccessToken(keys);

    await verifyAccessToken(token, jwks);
    await verifyAccessToken(token, jwks);
    await verifyAccessToken(await signAccessToken(keys, { roles: [Role.TOUR_OPERATOR] }), jwks);

    expect(fetchJwks).toHaveBeenCalledTimes(1);
    expect(fetchJwks.mock.calls[0]![0]).toBe(`${API_URL}/.well-known/jwks.json`);
  });
});

describe('middleware: acceso por rol con sesión válida', () => {
  it('deja pasar al rol que corresponde, sin tocar cookies', async () => {
    const { middleware, refresh } = setup();
    const token = await signAccessToken(keys, { roles: [Role.DISPATCHER] });

    const response = await middleware(pageRequest('/despacho', { [ACCESS_COOKIE]: token }));

    expect(isNext(response)).toBe(true);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ADMIN entra también a /despacho y /operador', async () => {
    const { middleware } = setup();
    const token = await signAccessToken(keys, { roles: [Role.ADMIN] });
    for (const path of ['/admin', '/despacho/alertas', '/operador']) {
      expect(isNext(await middleware(pageRequest(path, { [ACCESS_COOKIE]: token })))).toBe(true);
    }
  });

  it('un rol que no corresponde recibe la página 403, no una redirección', async () => {
    const { middleware } = setup();
    const token = await signAccessToken(keys, { roles: [Role.DISPATCHER] });

    const response = await middleware(pageRequest('/admin', { [ACCESS_COOKIE]: token }));

    expect(response.status).toBe(403);
    expect(rewrittenTo(response)).toBe('/prohibido');
    expect(response.headers.get('location')).toBeNull();
  });

  it('una cuenta sin roles de personal ve "usa la app PANTER" (403)', async () => {
    const { middleware } = setup();
    const token = await signAccessToken(keys, { roles: [Role.PASSENGER, Role.DRIVER] });

    for (const path of ['/operador', '/login']) {
      const response = await middleware(pageRequest(path, { [ACCESS_COOKIE]: token }));
      expect(response.status).toBe(403);
      expect(rewrittenTo(response)).toBe('/solo-personal');
    }
  });

  it('con sesión, /login redirige al panel del rol o al next permitido', async () => {
    const { middleware } = setup();
    const operador = await signAccessToken(keys, { roles: [Role.TOUR_OPERATOR] });
    const admin = await signAccessToken(keys, { roles: [Role.ADMIN] });

    const toHome = await middleware(pageRequest('/login', { [ACCESS_COOKIE]: operador }));
    expect(toHome.status).toBe(307);
    expect(toHome.headers.get('location')).toBe(`${WEB_ORIGIN}/operador`);

    const toNext = await middleware(
      pageRequest('/login?next=%2Fdespacho%2Falertas', { [ACCESS_COOKIE]: admin }),
    );
    expect(toNext.headers.get('location')).toBe(`${WEB_ORIGIN}/despacho/alertas`);
  });
});

describe('middleware: sin sesión', () => {
  it('una ruta privada redirige a /login?next=… conservando la ruta', async () => {
    const { middleware } = setup();

    const response = await middleware(pageRequest('/operador/reservas?dia=hoy'));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/operador/reservas?dia=hoy');
  });

  it('/login se muestra', async () => {
    const { middleware } = setup();
    expect(isNext(await middleware(pageRequest('/login')))).toBe(true);
  });

  it('un token inválido sin refresh lleva al login y borra las cookies', async () => {
    const { middleware } = setup();
    const forged = await signAccessToken(otherKeys, { kid: keys.kid });

    const response = await middleware(pageRequest('/admin', { [ACCESS_COOKIE]: forged }));

    expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
    expect(setCookie(response, ACCESS_COOKIE)?.['max-age']).toBe('0');
  });

  it('si el JWKS no responde, no refresca ni borra cookies', async () => {
    const { middleware, refresh } = setup({
      jwks: jwksFetch(() => new Response('caído', { status: 503 })),
    });
    const token = await signAccessToken(keys);

    const response = await middleware(
      pageRequest('/admin', { [ACCESS_COOKIE]: token, [REFRESH_COOKIE]: 'rt-viejo' }),
    );

    expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
    expect(refresh).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe('middleware: expiración y refresco', () => {
  it('con el access token vencido, refresca, reescribe las cookies y continúa', async () => {
    const pair = await tokenPair(keys, [Role.DISPATCHER], 'rt-rotado');
    const { middleware, refresh } = setup({ refresh: () => Promise.resolve(pair) });
    const expired = await signAccessToken(keys, { roles: [Role.DISPATCHER], expiresIn: -60 });

    const response = await middleware(
      pageRequest('/despacho', { [ACCESS_COOKIE]: expired, [REFRESH_COOKIE]: 'rt-viejo' }),
    );

    expect(refresh).toHaveBeenCalledWith('rt-viejo');
    expect(isNext(response)).toBe(true);
    const access = setCookie(response, ACCESS_COOKIE);
    const refreshCookie = setCookie(response, REFRESH_COOKIE);
    expect(access).toMatchObject({
      value: pair.accessToken,
      'max-age': String(pair.expiresIn),
      path: '/',
      httponly: 'true',
      secure: 'true',
      samesite: 'lax',
    });
    expect(refreshCookie).toMatchObject({
      value: 'rt-rotado',
      'max-age': String(pair.refreshExpiresIn),
      httponly: 'true',
      secure: 'true',
    });
    // La página de esta misma petición ve el token nuevo.
    expect(response.headers.get('x-middleware-request-cookie')).toContain(pair.accessToken);
  });

  it('si la cookie del access token ya expiró en el navegador, refresca con el refresh token', async () => {
    const pair = await tokenPair(keys, [Role.ADMIN]);
    const { middleware, refresh } = setup({ refresh: () => Promise.resolve(pair) });

    const response = await middleware(pageRequest('/admin', { [REFRESH_COOKIE]: 'rt-viejo' }));

    expect(refresh).toHaveBeenCalledOnce();
    expect(isNext(response)).toBe(true);
    expect(setCookie(response, ACCESS_COOKIE)?.value).toBe(pair.accessToken);
  });

  it('en /login, un refresh exitoso redirige al panel con las cookies nuevas', async () => {
    const pair = await tokenPair(keys, [Role.TOUR_OPERATOR]);
    const { middleware } = setup({ refresh: () => Promise.resolve(pair) });

    const response = await middleware(pageRequest('/login', { [REFRESH_COOKIE]: 'rt-viejo' }));

    expect(response.headers.get('location')).toBe(`${WEB_ORIGIN}/operador`);
    expect(setCookie(response, REFRESH_COOKIE)?.value).toBe(pair.refreshToken);
  });

  it('si el rol refrescado no corresponde, responde 403 y guarda igual las cookies nuevas', async () => {
    const pair = await tokenPair(keys, [Role.TOUR_OPERATOR]);
    const { middleware } = setup({ refresh: () => Promise.resolve(pair) });

    const response = await middleware(pageRequest('/despacho', { [REFRESH_COOKIE]: 'rt-viejo' }));

    expect(response.status).toBe(403);
    expect(rewrittenTo(response)).toBe('/prohibido');
    expect(setCookie(response, ACCESS_COOKIE)?.value).toBe(pair.accessToken);
  });

  it('un refresh rechazado lleva al login y borra las dos cookies', async () => {
    const { middleware } = setup({
      refresh: () =>
        Promise.reject(
          new ApiError({ code: ApiErrorCode.REFRESH_TOKEN_INVALID, message: 'x', status: 401 }),
        ),
    });
    const expired = await signAccessToken(keys, { expiresIn: -60 });

    const response = await middleware(
      pageRequest('/admin', { [ACCESS_COOKIE]: expired, [REFRESH_COOKIE]: 'rt-revocado' }),
    );

    expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
    expect(setCookie(response, ACCESS_COOKIE)).toMatchObject({ value: '', 'max-age': '0' });
    expect(setCookie(response, REFRESH_COOKIE)).toMatchObject({ value: '', 'max-age': '0' });
  });

  it('si la API no responde al refrescar, lleva al login sin borrar las cookies', async () => {
    const { middleware } = setup({
      refresh: () =>
        Promise.reject(new ApiError({ code: ClientErrorCode.NETWORK_ERROR, message: 'x' })),
    });

    const response = await middleware(pageRequest('/admin', { [REFRESH_COOKIE]: 'rt' }));

    expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('no gasta dos veces el mismo refresh token en peticiones simultáneas', async () => {
    const pair = await tokenPair(keys, [Role.ADMIN]);
    const { middleware, refresh } = setup({ refresh: () => Promise.resolve(pair) });

    const responses = await Promise.all(
      ['/admin', '/despacho', '/operador'].map((path) =>
        middleware(pageRequest(path, { [REFRESH_COOKIE]: 'rt-compartido' })),
      ),
    );

    expect(refresh).toHaveBeenCalledOnce();
    for (const response of responses) {
      expect(setCookie(response, ACCESS_COOKIE)?.value).toBe(pair.accessToken);
    }
  });

  it('reintenta el refresh si el intento anterior falló', async () => {
    const pair = await tokenPair(keys, [Role.ADMIN]);
    const refresh = vi
      .fn<(token: string) => Promise<TokenPairResponse>>()
      .mockRejectedValueOnce(new ApiError({ code: ClientErrorCode.NETWORK_ERROR, message: 'x' }))
      .mockResolvedValueOnce(pair);
    const { middleware } = setup({ refresh });

    await middleware(pageRequest('/admin', { [REFRESH_COOKIE]: 'rt' }));
    const second = await middleware(pageRequest('/admin', { [REFRESH_COOKIE]: 'rt' }));

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(isNext(second)).toBe(true);
  });
});
