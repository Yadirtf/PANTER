import { AuthRoutes, MeResponseSchema } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  apiError,
  BASE_URL,
  deferred,
  fakeFetch,
  jsonResponse,
  makeTokenPair,
  makeUser,
  type Route,
} from '../../../test/fake-api';
import type { ApiError } from '../../../shared/api/errors';
import { createHttpClient } from '../../../shared/api/http-client';
import { createAuthApi } from '../api/auth-api';
import { SessionManager } from './session-manager';
import {
  createMemoryKeyValueStore,
  createSessionStorage,
  sessionFromTokenPair,
  STORAGE_KEYS,
} from './session-storage';

const START = 1_800_000_000_000;
const MINUTE = 60_000;

/** App completa con la API simulada: cliente HTTP, API de identidad, almacenamiento y store. */
function setup(route: Route, options: { stored?: number; storedAt?: number } = {}) {
  const clock = { now: START };
  const kv = createMemoryKeyValueStore();
  const storage = createSessionStorage(kv);
  const fetch = fakeFetch(route);
  const http = createHttpClient({ baseUrl: BASE_URL, fetch });
  const api = createAuthApi(http);
  const manager = new SessionManager({ api, storage, now: () => clock.now });
  http.setAuthHandler(manager);
  const seed = async () => {
    if (options.stored !== undefined) {
      await storage.save(
        sessionFromTokenPair(makeTokenPair(options.stored), options.storedAt ?? START),
      );
    }
  };
  const getMe = () => http.request({ path: AuthRoutes.ME, auth: true, schema: MeResponseSchema });
  return { clock, kv, storage, fetch, http, api, manager, seed, getMe };
}

const refreshCalls = (calls: { path: string }[]) =>
  calls.filter((c) => c.path === AuthRoutes.REFRESH).length;

describe('SessionManager: carga', () => {
  it('empieza en loading y sin sesión guardada pasa a signedOut', async () => {
    const { manager } = setup(() => jsonResponse(500, {}));
    expect(manager.getState().status).toBe('loading');
    await manager.load();
    expect(manager.getState()).toEqual({
      status: 'signedOut',
      user: null,
      activeMode: null,
      signedOutReason: null,
    });
  });

  it('con sesión guardada pasa a signedIn con user y activeMode', async () => {
    const t = setup(() => jsonResponse(500, {}), { stored: 1 });
    await t.seed();
    await t.manager.load();
    expect(t.manager.getState()).toMatchObject({
      status: 'signedIn',
      user: makeUser(),
      activeMode: 'passenger',
    });
  });

  it('si el refresh token guardado ya venció, cierra la sesión y borra el almacenamiento', async () => {
    const t = setup(() => jsonResponse(500, {}), {
      stored: 1,
      storedAt: START - 31 * 24 * 60 * MINUTE,
    });
    await t.seed();
    await t.manager.load();
    expect(t.manager.getState().status).toBe('signedOut');
    expect(t.kv.data.size).toBe(0);
    expect(t.fetch.calls).toHaveLength(0);
  });

  it('notifica a los suscriptores en cada cambio', async () => {
    const t = setup(() => jsonResponse(500, {}));
    const seen: string[] = [];
    const unsubscribe = t.manager.subscribe(() => seen.push(t.manager.getState().status));
    await t.manager.load();
    await t.manager.signIn(makeTokenPair(1));
    unsubscribe();
    await t.manager.signOut();
    expect(seen).toEqual(['signedOut', 'signedIn']);
  });
});

describe('SessionManager: login y logout', () => {
  it('signIn guarda refresh y access token en el almacenamiento seguro', async () => {
    const t = setup(() => jsonResponse(500, {}));
    await t.manager.load();
    await t.manager.signIn(
      makeTokenPair(1, {
        user: makeUser({ activeMode: 'driver', roles: ['PASSENGER', 'DRIVER'] }),
      }),
    );
    expect(t.kv.data.get(STORAGE_KEYS.REFRESH_TOKEN)).toBe('refresh-1');
    expect(t.kv.data.get(STORAGE_KEYS.ACCESS_TOKEN)).toBe('access-1');
    expect(t.manager.getState()).toMatchObject({ status: 'signedIn', activeMode: 'driver' });
  });

  it('signOut llama a POST /auth/logout con el refresh token y borra el almacenamiento', async () => {
    const t = setup(() => new Response(null, { status: 204 }), { stored: 1 });
    await t.seed();
    await t.manager.load();
    await t.manager.signOut();
    expect(t.fetch.calls).toEqual([
      expect.objectContaining({
        path: AuthRoutes.LOGOUT,
        body: { refreshToken: 'refresh-1' },
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      }),
    ]);
    expect(t.kv.data.size).toBe(0);
    expect(t.manager.getState()).toMatchObject({ status: 'signedOut', signedOutReason: null });
  });

  it('signOut sin red igual borra la sesión local', async () => {
    const t = setup(
      () => {
        throw new TypeError('Network request failed');
      },
      { stored: 1 },
    );
    await t.seed();
    await t.manager.load();
    await expect(t.manager.signOut()).resolves.toBeUndefined();
    expect(t.kv.data.size).toBe(0);
    expect(t.manager.getState().status).toBe('signedOut');
  });
});

describe('SessionManager: refresco del access token', () => {
  it('usa el access token vigente sin refrescar', async () => {
    const t = setup(() => jsonResponse(200, makeUser()), { stored: 1 });
    await t.seed();
    await expect(t.getMe()).resolves.toMatchObject({ email: 'ana@example.com' });
    expect(t.fetch.calls.map((c) => c.headers.Authorization)).toEqual(['Bearer access-1']);
  });

  it('refresca antes de que venza el access token y guarda el par rotado', async () => {
    const t = setup(
      (req) =>
        req.path === AuthRoutes.REFRESH
          ? jsonResponse(200, makeTokenPair(2))
          : jsonResponse(200, makeUser()),
      { stored: 1 },
    );
    await t.seed();
    t.clock.now = START + 14.5 * MINUTE; // quedan 30 s de los 15 min

    await t.getMe();

    expect(t.fetch.calls.map((c) => c.path)).toEqual([AuthRoutes.REFRESH, AuthRoutes.ME]);
    expect(t.fetch.calls[0]?.body).toEqual({ refreshToken: 'refresh-1' });
    expect(t.fetch.calls[1]?.headers.Authorization).toBe('Bearer access-2');
    expect(t.kv.data.get(STORAGE_KEYS.REFRESH_TOKEN)).toBe('refresh-2');
  });

  it('varias peticiones a la vez con el token por vencer hacen un solo refresh', async () => {
    const gate = deferred<void>();
    const t = setup(
      async (req) => {
        if (req.path === AuthRoutes.REFRESH) {
          await gate.promise;
          return jsonResponse(200, makeTokenPair(2));
        }
        return jsonResponse(200, makeUser());
      },
      { stored: 1 },
    );
    await t.seed();
    t.clock.now = START + 15 * MINUTE;

    const all = Promise.all([t.getMe(), t.getMe(), t.getMe(), t.getMe()]);
    gate.resolve();
    await all;

    expect(refreshCalls(t.fetch.calls)).toBe(1);
    const meCalls = t.fetch.calls.filter((c) => c.path === AuthRoutes.ME);
    expect(meCalls.map((c) => c.headers.Authorization)).toEqual(Array(4).fill('Bearer access-2'));
  });

  it('varias peticiones que reciben 401 TOKEN_EXPIRED a la vez hacen un solo refresh y reintentan', async () => {
    const gate = deferred<void>();
    let refreshes = 0;
    const t = setup(
      async (req) => {
        if (req.path === AuthRoutes.REFRESH) {
          refreshes += 1;
          await gate.promise;
          return jsonResponse(200, makeTokenPair(2));
        }
        // El servidor ya considera vencido access-1 aunque el reloj del teléfono no.
        return req.headers.Authorization === 'Bearer access-1'
          ? apiError(401, 'TOKEN_EXPIRED')
          : jsonResponse(200, makeUser());
      },
      { stored: 1 },
    );
    await t.seed();

    const pending = [t.getMe(), t.getMe(), t.getMe()];
    // Deja que las tres reciban el 401 antes de responder el refresh.
    await new Promise((resolve) => setTimeout(resolve, 0));
    gate.resolve();
    await Promise.all(pending);

    expect(refreshes).toBe(1);
    const retried = t.fetch.calls.filter((c) => c.headers.Authorization === 'Bearer access-2');
    expect(retried).toHaveLength(3);
  });

  it('un 401 que llega después de otro refresh usa el token nuevo sin refrescar de nuevo', async () => {
    const t = setup(
      (req) => {
        if (req.path === AuthRoutes.REFRESH) return jsonResponse(200, makeTokenPair(2));
        return jsonResponse(200, makeUser());
      },
      { stored: 1 },
    );
    await t.seed();
    await t.manager.load();
    await t.manager.refreshAccessToken('access-1');
    await expect(t.manager.refreshAccessToken('access-1')).resolves.toBe('access-2');
    expect(refreshCalls(t.fetch.calls)).toBe(1);
  });

  it('si el refresh falla con REFRESH_TOKEN_INVALID cierra la sesión y va al login', async () => {
    const t = setup(
      (req) =>
        req.path === AuthRoutes.REFRESH
          ? apiError(401, 'REFRESH_TOKEN_INVALID')
          : jsonResponse(200, makeUser()),
      { stored: 1 },
    );
    await t.seed();
    t.clock.now = START + 15 * MINUTE;

    const results = await Promise.allSettled([t.getMe(), t.getMe()]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(((results[0] as PromiseRejectedResult).reason as ApiError).code).toBe(
      'REFRESH_TOKEN_INVALID',
    );
    expect(refreshCalls(t.fetch.calls)).toBe(1);
    expect(t.manager.getState()).toMatchObject({
      status: 'signedOut',
      signedOutReason: 'REFRESH_TOKEN_INVALID',
    });
    expect(t.kv.data.size).toBe(0);
  });

  it('si el refresh falla sin red conserva la sesión', async () => {
    const t = setup(
      (req) => {
        if (req.path === AuthRoutes.REFRESH) throw new TypeError('Network request failed');
        return jsonResponse(200, makeUser());
      },
      { stored: 1 },
    );
    await t.seed();
    t.clock.now = START + 15 * MINUTE;

    await expect(t.getMe()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(t.manager.getState().status).toBe('signedIn');
    expect(t.kv.data.get(STORAGE_KEYS.REFRESH_TOKEN)).toBe('refresh-1');
  });

  it('un refresh que termina después de cerrar sesión no revive la sesión', async () => {
    const gate = deferred<void>();
    const t = setup(
      async (req) => {
        if (req.path === AuthRoutes.REFRESH) {
          await gate.promise;
          return jsonResponse(200, makeTokenPair(2));
        }
        return new Response(null, { status: 204 });
      },
      { stored: 1 },
    );
    await t.seed();
    t.clock.now = START + 15 * MINUTE;

    const request = t.getMe();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.manager.signOut();
    gate.resolve();

    await expect(request).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(t.manager.getState().status).toBe('signedOut');
    expect(t.kv.data.size).toBe(0);
  });

  it('sin sesión las peticiones autenticadas fallan con UNAUTHENTICATED', async () => {
    const t = setup(() => jsonResponse(200, makeUser()));
    await expect(t.getMe()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(t.fetch.calls).toHaveLength(0);
  });
});

describe('SessionManager: perfil al iniciar (GET /me)', () => {
  it('start carga la sesión y actualiza roles y modo con GET /me', async () => {
    const approved = makeUser({ roles: ['PASSENGER', 'DRIVER'] });
    const t = setup(() => jsonResponse(200, approved), { stored: 1 });
    await t.seed();

    await t.manager.start();

    expect(t.fetch.calls.map((c) => c.path)).toEqual([AuthRoutes.ME]);
    expect(t.manager.getState().user?.roles).toEqual(['PASSENGER', 'DRIVER']);
    await expect(t.storage.load()).resolves.toMatchObject({ user: approved });
  });

  it('sin sesión guardada no llama a GET /me', async () => {
    const t = setup(() => jsonResponse(200, makeUser()));
    await t.manager.start();
    expect(t.fetch.calls).toHaveLength(0);
    expect(t.manager.getState().status).toBe('signedOut');
  });

  it('sin red conserva los datos guardados', async () => {
    const t = setup(
      () => {
        throw new TypeError('Network request failed');
      },
      { stored: 1 },
    );
    await t.seed();
    await t.manager.start();
    expect(t.manager.getState()).toMatchObject({ status: 'signedIn', user: makeUser() });
  });

  it('si la cuenta fue suspendida cierra la sesión', async () => {
    for (const route of [
      () => apiError(403, 'ACCOUNT_SUSPENDED'),
      () => jsonResponse(200, makeUser({ status: 'SUSPENDED' })),
    ]) {
      const t = setup(route, { stored: 1 });
      await t.seed();
      await t.manager.start();
      expect(t.manager.getState()).toMatchObject({
        status: 'signedOut',
        signedOutReason: 'ACCOUNT_SUSPENDED',
      });
      expect(t.kv.data.size).toBe(0);
    }
  });
});

describe('SessionManager: cambio de modo (POST /me/mode)', () => {
  const driverUser = makeUser({ roles: ['PASSENGER', 'DRIVER'], activeMode: 'driver' });

  it('envía { mode } y guarda el par de tokens nuevo', async () => {
    const t = setup(() => jsonResponse(200, makeTokenPair(2, { user: driverUser })), {
      stored: 1,
    });
    await t.seed();
    await t.manager.load();

    await t.manager.switchMode('driver');

    expect(t.fetch.calls).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: AuthRoutes.ME_MODE,
        body: { mode: 'driver' },
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      }),
    ]);
    expect(t.manager.getState()).toMatchObject({ activeMode: 'driver', user: driverUser });
    expect(t.kv.data.get(STORAGE_KEYS.ACCESS_TOKEN)).toBe('access-2');
    expect(t.kv.data.get(STORAGE_KEYS.REFRESH_TOKEN)).toBe('refresh-2');
  });

  it.each(['MODE_CHANGE_ACTIVE_TRIP', 'MODE_NOT_ALLOWED'])(
    'si responde %s lanza el error y no cambia la sesión',
    async (code) => {
      const t = setup(() => apiError(409, code), { stored: 1 });
      await t.seed();
      await t.manager.load();

      await expect(t.manager.switchMode('driver')).rejects.toMatchObject({ code });
      expect(t.manager.getState()).toMatchObject({ status: 'signedIn', activeMode: 'passenger' });
      expect(t.kv.data.get(STORAGE_KEYS.ACCESS_TOKEN)).toBe('access-1');
    },
  );

  it('con el access token vencido refresca antes de cambiar de modo', async () => {
    const t = setup(
      (req) => {
        if (req.path === AuthRoutes.REFRESH) return jsonResponse(200, makeTokenPair(2));
        return jsonResponse(200, makeTokenPair(3, { user: driverUser }));
      },
      { stored: 1 },
    );
    await t.seed();
    t.clock.now = START + 20 * MINUTE;

    await t.manager.switchMode('driver');

    expect(t.fetch.calls.map((c) => c.path)).toEqual([AuthRoutes.REFRESH, AuthRoutes.ME_MODE]);
    expect(t.fetch.calls[1]?.headers.Authorization).toBe('Bearer access-2');
    expect(t.kv.data.get(STORAGE_KEYS.REFRESH_TOKEN)).toBe('refresh-3');
  });

  it('un refresh en curso no pisa el par emitido por el cambio de modo', async () => {
    const gate = deferred<void>();
    const t = setup(
      async (req) => {
        if (req.path === AuthRoutes.REFRESH) {
          await gate.promise;
          // El cambio de modo rotó el refresh token: el anterior ya no sirve.
          return apiError(401, 'REFRESH_TOKEN_INVALID');
        }
        return jsonResponse(200, makeTokenPair(3, { user: driverUser }));
      },
      { stored: 1 },
    );
    await t.seed();
    await t.manager.load();

    const refreshing = t.manager.refreshAccessToken('access-1');
    await t.manager.switchMode('driver');
    gate.resolve();

    await expect(refreshing).resolves.toBe('access-3');
    expect(t.manager.getState()).toMatchObject({ status: 'signedIn', activeMode: 'driver' });
    expect(t.kv.data.get(STORAGE_KEYS.REFRESH_TOKEN)).toBe('refresh-3');
  });
});
