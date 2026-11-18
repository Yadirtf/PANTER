import { ApiErrorCode, Role, type TokenPairResponse } from '@panter/contracts';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/errors';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './cookies';
import { callWithSession, createRefreshCoordinator } from './session-call';
import { handleRefreshRedirect } from './session-routes';
import { createTestKeys, setCookie, tokenPair, WEB_ORIGIN, type TestKeys } from './test-helpers';

let keys: TestKeys;
beforeAll(async () => {
  keys = await createTestKeys();
});

const expired = () =>
  new ApiError({ code: ApiErrorCode.TOKEN_EXPIRED, message: 'vencido', status: 401 });

describe('callWithSession', () => {
  it('usa el access token de la cookie y no refresca si la API lo acepta', async () => {
    const refresh = vi.fn<(token: string) => Promise<TokenPairResponse>>();
    const call = vi.fn(async (token: string) => `ok:${token}`);
    const result = await callWithSession({ accessToken: 'at', refreshToken: 'rt' }, refresh, call);
    expect(result).toEqual({ value: 'ok:at' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('con 401 TOKEN_EXPIRED refresca una vez y repite con el token nuevo', async () => {
    const fresh = await tokenPair(keys, [Role.ADMIN]);
    const refresh = vi.fn(async () => fresh);
    const call = vi
      .fn<(token: string) => Promise<string>>()
      .mockRejectedValueOnce(expired())
      .mockResolvedValueOnce('ok');
    const result = await callWithSession({ accessToken: 'at', refreshToken: 'rt' }, refresh, call);
    expect(result).toEqual({ value: 'ok', refreshed: fresh });
    expect(refresh).toHaveBeenCalledWith('rt');
    expect(call.mock.calls.map(([token]) => token)).toEqual(['at', fresh.accessToken]);
  });

  it('no refresca por otros errores (403 FORBIDDEN)', async () => {
    const refresh = vi.fn<(token: string) => Promise<TokenPairResponse>>();
    const forbidden = new ApiError({ code: ApiErrorCode.FORBIDDEN, message: 'no', status: 403 });
    await expect(
      callWithSession({ accessToken: 'at', refreshToken: 'rt' }, refresh, () =>
        Promise.reject(forbidden),
      ),
    ).rejects.toBe(forbidden);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('sin refresh (Server Components) propaga TOKEN_EXPIRED; sin tokens lanza UNAUTHENTICATED', async () => {
    await expect(
      callWithSession({ accessToken: 'at', refreshToken: 'rt' }, null, () =>
        Promise.reject(expired()),
      ),
    ).rejects.toMatchObject({ code: ApiErrorCode.TOKEN_EXPIRED });
    await expect(callWithSession({}, vi.fn(), async () => 'x')).rejects.toMatchObject({
      code: ApiErrorCode.UNAUTHENTICATED,
      status: 401,
    });
  });
});

describe('createRefreshCoordinator', () => {
  it('reutiliza el refresh en curso para el mismo refresh token', async () => {
    const fresh = await tokenPair(keys, [Role.ADMIN]);
    const refresh = vi.fn(async () => fresh);
    const once = createRefreshCoordinator(refresh);
    const [a, b] = await Promise.all([once('rt'), once('rt')]);
    expect(a).toBe(b);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/session/refresh', () => {
  function get(next: string, cookies: Record<string, string> = { [REFRESH_COOKIE]: 'rt' }) {
    const cookie = Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    return new NextRequest(
      new URL(`/api/session/refresh?next=${encodeURIComponent(next)}`, WEB_ORIGIN),
      { headers: cookie ? { cookie } : {} },
    );
  }

  it('refresca, guarda las cookies y vuelve a la página', async () => {
    const fresh = await tokenPair(keys, [Role.ADMIN], 'rt-rotado');
    const response = await handleRefreshRedirect(get('/admin/usuarios?q=ana'), {
      refresh: async () => fresh,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${WEB_ORIGIN}/admin/usuarios?q=ana`);
    expect(setCookie(response, ACCESS_COOKIE)?.value).toBe(fresh.accessToken);
    expect(setCookie(response, REFRESH_COOKIE)?.value).toBe('rt-rotado');
  });

  it('no acepta destinos de otro sitio', async () => {
    const fresh = await tokenPair(keys, [Role.ADMIN]);
    const response = await handleRefreshRedirect(get('//malo.example/x'), {
      refresh: async () => fresh,
    });
    expect(response.headers.get('location')).toBe(`${WEB_ORIGIN}/login`);
  });

  it('si el refresh es rechazado borra las cookies y lleva al login con next', async () => {
    const response = await handleRefreshRedirect(get('/admin/usuarios'), {
      refresh: () =>
        Promise.reject(
          new ApiError({ code: ApiErrorCode.REFRESH_TOKEN_INVALID, message: 'x', status: 401 }),
        ),
    });
    expect(response.headers.get('location')).toBe(`${WEB_ORIGIN}/login?next=%2Fadmin%2Fusuarios`);
    expect(setCookie(response, REFRESH_COOKIE)?.['max-age']).toBe('0');
  });

  it('sin refresh token lleva al login', async () => {
    const response = await handleRefreshRedirect(get('/admin/usuarios', {}), {
      refresh: vi.fn(),
    });
    expect(response.headers.get('location')).toBe(`${WEB_ORIGIN}/login?next=%2Fadmin%2Fusuarios`);
  });

  it('si la API no responde no borra la sesión ni redirige en bucle (503)', async () => {
    const response = await handleRefreshRedirect(get('/admin/usuarios'), {
      refresh: () => Promise.reject(new ApiError({ code: 'NETWORK_ERROR', message: 'x' })),
    });
    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.text()).toMatch(/No pudimos renovar tu sesión/);
  });
});
