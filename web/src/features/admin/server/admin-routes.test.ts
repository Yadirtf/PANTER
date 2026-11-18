import { ApiErrorCode, Role, type TokenPairResponse } from '@panter/contracts';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/features/auth/server/cookies';
import {
  API_URL,
  apiError,
  createTestKeys,
  jsonResponse,
  setCookie,
  tokenPair,
  WEB_ORIGIN,
  type TestKeys,
} from '@/features/auth/server/test-helpers';
import { ApiError } from '@/shared/api/errors';
import { createAdminApi } from './admin-api';
import { handleGrantRole, handleListUsers, handleRevokeRole } from './admin-routes';
import { adminUser, OTHER_ID, otherUser } from './admin-test-data';

let keys: TestKeys;
beforeAll(async () => {
  keys = await createTestKeys();
});

const ACCESS = 'at-de-la-cookie';
const REFRESH = 'rt-de-la-cookie';
const SESSION = { [ACCESS_COOKIE]: ACCESS, [REFRESH_COOKIE]: REFRESH };

type Handler = (request: Request) => Response | Promise<Response>;

/** API simulada: responde según "MÉTODO /ruta". */
function mockApi(routes: Record<string, Handler | Handler[]>) {
  const calls = new Map<string, number>();
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const entry = routes[key];
    if (!entry) throw new Error(`Ruta no simulada: ${key}`);
    const n = calls.get(key) ?? 0;
    calls.set(key, n + 1);
    const handler = Array.isArray(entry) ? entry[Math.min(n, entry.length - 1)]! : entry;
    return handler(new Request(url, init));
  });
  const refresh = vi.fn<(token: string) => Promise<TokenPairResponse>>(() =>
    Promise.reject(new Error('refresh no esperado')),
  );
  return {
    fetchMock,
    refresh,
    deps: { admin: createAdminApi({ apiUrl: API_URL, fetch: fetchMock }), refresh },
  };
}

function request(
  method: string,
  path: string,
  options: {
    body?: unknown;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  } = {},
): NextRequest {
  const cookies = options.cookies ?? SESSION;
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return new NextRequest(new URL(path, WEB_ORIGIN), {
    method,
    headers: {
      host: new URL(WEB_ORIGIN).host,
      origin: WEB_ORIGIN,
      'sec-fetch-site': 'same-origin',
      ...(cookie ? { cookie } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function authorizationOf(fetchMock: ReturnType<typeof mockApi>['fetchMock'], call = 0) {
  const headers = fetchMock.mock.calls[call]![1]!.headers as Record<string, string>;
  return headers.authorization;
}

describe('GET /api/admin/users', () => {
  it('llama a /admin/users con el access token de la cookie como Bearer', async () => {
    const page = { items: [adminUser()], nextCursor: 'c2' };
    const { fetchMock, deps } = mockApi({ 'GET /admin/users': () => jsonResponse(page) });

    const response = await handleListUsers(
      request('GET', '/api/admin/users?q=%20Ana@Panter%20&cursor=c1'),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page);
    expect(authorizationOf(fetchMock)).toBe(`Bearer ${ACCESS}`);
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.origin).toBe(API_URL);
    expect(url.searchParams.get('q')).toBe('Ana@Panter');
    expect(url.searchParams.get('cursor')).toBe('c1');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('nunca devuelve los tokens al navegador', async () => {
    const { deps } = mockApi({
      'GET /admin/users': () => jsonResponse({ items: [otherUser()], nextCursor: null }),
    });
    const response = await handleListUsers(request('GET', '/api/admin/users'), deps);
    const text = await response.text();
    expect(text).not.toContain(ACCESS);
    expect(text).not.toContain(REFRESH);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('con 401 TOKEN_EXPIRED refresca, repite con el token nuevo y guarda las cookies', async () => {
    const fresh = await tokenPair(keys, [Role.ADMIN], 'rt-rotado');
    const page = { items: [adminUser()], nextCursor: null };
    const { fetchMock, refresh, deps } = mockApi({
      'GET /admin/users': [
        () => apiError(401, ApiErrorCode.TOKEN_EXPIRED),
        () => jsonResponse(page),
      ],
    });
    refresh.mockResolvedValue(fresh);

    const response = await handleListUsers(request('GET', '/api/admin/users'), deps);

    expect(response.status).toBe(200);
    expect(refresh).toHaveBeenCalledWith(REFRESH);
    expect(authorizationOf(fetchMock, 0)).toBe(`Bearer ${ACCESS}`);
    expect(authorizationOf(fetchMock, 1)).toBe(`Bearer ${fresh.accessToken}`);
    expect(setCookie(response, ACCESS_COOKIE)).toMatchObject({
      value: fresh.accessToken,
      httponly: 'true',
    });
    expect(setCookie(response, REFRESH_COOKIE)?.value).toBe('rt-rotado');
    expect(await response.text()).not.toContain(fresh.accessToken);
  });

  it('sin access token pero con refresh token, refresca antes de llamar', async () => {
    const fresh = await tokenPair(keys, [Role.ADMIN]);
    const { fetchMock, refresh, deps } = mockApi({
      'GET /admin/users': () => jsonResponse({ items: [], nextCursor: null }),
    });
    refresh.mockResolvedValue(fresh);

    const response = await handleListUsers(
      request('GET', '/api/admin/users', { cookies: { [REFRESH_COOKIE]: REFRESH } }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authorizationOf(fetchMock)).toBe(`Bearer ${fresh.accessToken}`);
  });

  it('si el refresh es rechazado responde 401 y borra las cookies', async () => {
    const { refresh, deps } = mockApi({
      'GET /admin/users': () => apiError(401, ApiErrorCode.TOKEN_EXPIRED),
    });
    refresh.mockRejectedValue(
      new ApiError({ code: ApiErrorCode.REFRESH_TOKEN_INVALID, message: 'x', status: 401 }),
    );

    const response = await handleListUsers(request('GET', '/api/admin/users'), deps);

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe(ApiErrorCode.REFRESH_TOKEN_INVALID);
    expect(setCookie(response, ACCESS_COOKIE)?.['max-age']).toBe('0');
    expect(setCookie(response, REFRESH_COOKIE)?.['max-age']).toBe('0');
  });

  it('sin cookies responde 401 UNAUTHENTICATED sin llamar a la API', async () => {
    const { fetchMock, deps } = mockApi({});
    const response = await handleListUsers(
      request('GET', '/api/admin/users', { cookies: {} }),
      deps,
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe(ApiErrorCode.UNAUTHENTICATED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pasa FORBIDDEN de la API tal cual (403)', async () => {
    const { deps } = mockApi({ 'GET /admin/users': () => apiError(403, ApiErrorCode.FORBIDDEN) });
    const response = await handleListUsers(request('GET', '/api/admin/users'), deps);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe(ApiErrorCode.FORBIDDEN);
  });

  it('rechaza peticiones de otro sitio', async () => {
    const { fetchMock, deps } = mockApi({});
    const response = await handleListUsers(
      request('GET', '/api/admin/users', { headers: { 'sec-fetch-site': 'cross-site' } }),
      deps,
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/users/:userId/roles', () => {
  it('otorga el rol con Bearer y devuelve el usuario actualizado', async () => {
    const updated = otherUser();
    const { fetchMock, deps } = mockApi({
      [`POST /admin/users/${OTHER_ID}/roles`]: () => jsonResponse(updated),
    });

    const response = await handleGrantRole(
      request('POST', `/api/admin/users/${OTHER_ID}/roles`, {
        body: { role: Role.DISPATCHER },
      }),
      OTHER_ID,
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(updated);
    expect(authorizationOf(fetchMock)).toBe(`Bearer ${ACCESS}`);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      role: Role.DISPATCHER,
    });
  });

  it('responde ROLE_NOT_GRANTABLE sin llamar a la API para PASSENGER o DRIVER', async () => {
    const { fetchMock, deps } = mockApi({});
    for (const role of [Role.PASSENGER, Role.DRIVER]) {
      const response = await handleGrantRole(
        request('POST', `/api/admin/users/${OTHER_ID}/roles`, { body: { role } }),
        OTHER_ID,
        deps,
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe(ApiErrorCode.ROLE_NOT_GRANTABLE);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pasa ROLE_NOT_GRANTABLE y NOT_FOUND de la API', async () => {
    const { deps } = mockApi({
      [`POST /admin/users/${OTHER_ID}/roles`]: [
        () => apiError(400, ApiErrorCode.ROLE_NOT_GRANTABLE),
        () => apiError(404, ApiErrorCode.NOT_FOUND),
      ],
    });
    const call = () =>
      handleGrantRole(
        request('POST', `/api/admin/users/${OTHER_ID}/roles`, { body: { role: Role.ADMIN } }),
        OTHER_ID,
        deps,
      );
    const first = await call();
    expect(first.status).toBe(400);
    expect((await first.json()).error.code).toBe(ApiErrorCode.ROLE_NOT_GRANTABLE);
    const second = await call();
    expect(second.status).toBe(404);
    expect((await second.json()).error.code).toBe(ApiErrorCode.NOT_FOUND);
  });

  it('un userId que no es UUID responde NOT_FOUND', async () => {
    const { fetchMock, deps } = mockApi({});
    const response = await handleGrantRole(
      request('POST', '/api/admin/users/x/roles', { body: { role: Role.ADMIN } }),
      '../me',
      deps,
    );
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('valida el cuerpo y el origen', async () => {
    const { fetchMock, deps } = mockApi({});
    const invalid = await handleGrantRole(
      request('POST', `/api/admin/users/${OTHER_ID}/roles`, { body: { role: 'ROOT' } }),
      OTHER_ID,
      deps,
    );
    expect(invalid.status).toBe(400);
    const crossSite = await handleGrantRole(
      request('POST', `/api/admin/users/${OTHER_ID}/roles`, {
        body: { role: Role.ADMIN },
        headers: { origin: 'https://malo.example', 'sec-fetch-site': 'cross-site' },
      }),
      OTHER_ID,
      deps,
    );
    expect(crossSite.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/users/:userId/roles/:role', () => {
  it('retira el rol con Bearer', async () => {
    const updated = otherUser({ roles: otherUser().roles.slice(0, 2) });
    const { fetchMock, deps } = mockApi({
      [`DELETE /admin/users/${OTHER_ID}/roles/DISPATCHER`]: () => jsonResponse(updated),
    });

    const response = await handleRevokeRole(
      request('DELETE', `/api/admin/users/${OTHER_ID}/roles/DISPATCHER`),
      OTHER_ID,
      'DISPATCHER',
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(updated);
    expect(authorizationOf(fetchMock)).toBe(`Bearer ${ACCESS}`);
  });

  it('pasa CANNOT_REVOKE_OWN_ADMIN (409) de la API', async () => {
    const { deps } = mockApi({
      [`DELETE /admin/users/${OTHER_ID}/roles/ADMIN`]: () =>
        apiError(409, ApiErrorCode.CANNOT_REVOKE_OWN_ADMIN),
    });
    const response = await handleRevokeRole(
      request('DELETE', `/api/admin/users/${OTHER_ID}/roles/ADMIN`),
      OTHER_ID,
      'ADMIN',
      deps,
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe(ApiErrorCode.CANNOT_REVOKE_OWN_ADMIN);
  });

  it('roles que no son de personal o desconocidos responden ROLE_NOT_GRANTABLE', async () => {
    const { fetchMock, deps } = mockApi({});
    for (const role of ['PASSENGER', 'DRIVER', 'ROOT']) {
      const response = await handleRevokeRole(
        request('DELETE', `/api/admin/users/${OTHER_ID}/roles/${role}`),
        OTHER_ID,
        role,
        deps,
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe(ApiErrorCode.ROLE_NOT_GRANTABLE);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si la API no responde devuelve 502 NETWORK_ERROR', async () => {
    const { deps } = mockApi({
      [`DELETE /admin/users/${OTHER_ID}/roles/ADMIN`]: () => {
        throw new TypeError('fetch failed');
      },
    });
    const response = await handleRevokeRole(
      request('DELETE', `/api/admin/users/${OTHER_ID}/roles/ADMIN`),
      OTHER_ID,
      'ADMIN',
      deps,
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('NETWORK_ERROR');
  });
});
