// HU-104: GET /me, POST /me/mode, requireRole() y requireMode() dentro de workerd.
import {
  AccessTokenClaimsSchema,
  ActiveMode,
  AuthRoutes,
  MeResponseSchema,
  Role,
  SwitchModeResponseSchema,
  TokenPairResponseSchema,
  type TokenPairResponse,
} from '@panter/contracts';
import { env, exports } from 'cloudflare:workers';
import { decodeJwt } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAuthFactories, requireAuth } from '../src/composition/auth';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { requireMode, requireRole } from '../src/modules/auth/http/authorize';
import { getActor } from '../src/modules/auth/http/require-auth';
import { createJoseAccessTokenSigner } from '../src/modules/auth/infrastructure/jose-access-tokens';
import {
  createRefreshTokenCodec,
  REFRESH_PREFIX,
} from '../src/modules/auth/infrastructure/refresh-tokens';
import { createRouter } from '../src/shared/http/create-app';
import { errorHandler, notFoundHandler } from '../src/shared/http/errors';
import { captureDelivery, MemoryUserRepository } from './support/auth-fakes';
import { testKeys, type TestKeys } from './support/jwt-keys';

const OTP_SECRET = 'test-otp-secret-0123456789abcdef0123456789abcdef';
const USER_ID = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';

let keys: TestKeys;
beforeAll(async () => {
  keys = await testKeys();
});
beforeEach(async () => {
  const { keys: list } = await env.KV.list();
  await Promise.all(list.map((k) => env.KV.delete(k.name)));
});

function testEnv(): Env {
  return {
    ...env,
    OTP_SECRET,
    JWT_PRIVATE_KEY: keys.privateKeyPem,
    JWT_PUBLIC_KEY: keys.publicKeyPem,
  };
}

interface ErrorJson {
  error: { code: string; message: string };
}

function setup(options: { activeTrip?: boolean } = {}) {
  const users = new MemoryUserRepository();
  const mail = captureDelivery();
  const setUnavailable = vi.fn(async () => {});
  const app = createApp({
    auth: buildAuthFactories({
      users: () => users,
      deliver: () => mail.deliver,
      activeTrips: () => ({ hasActiveTrip: async () => !!options.activeTrip }),
      driverAvailability: () => ({ setUnavailable }),
    }),
  });
  const request = (path: string, init: RequestInit & { token?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.token) headers.set('authorization', `Bearer ${init.token}`);
    if (init.body) headers.set('content-type', 'application/json');
    return app.request(path, { ...init, headers }, testEnv());
  };
  const post = (path: string, body: unknown, token?: string) =>
    request(path, { method: 'POST', body: JSON.stringify(body), token });
  async function login(email = 'ana@panter.test'): Promise<TokenPairResponse> {
    await post(AuthRoutes.OTP_REQUEST, { email });
    const res = await post(AuthRoutes.OTP_VERIFY, { email, code: mail.lastCode(email) });
    expect(res.status).toBe(200);
    return TokenPairResponseSchema.parse(await res.json());
  }
  return { app, users, request, post, login, setUnavailable };
}

describe('GET /me', () => {
  it('devuelve el perfil con roles y modo activo (MeResponse)', async () => {
    const { login, request } = setup();
    const pair = await login();
    const res = await request(AuthRoutes.ME, { token: pair.accessToken });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const me = MeResponseSchema.parse(await res.json());
    expect(me).toEqual(pair.user);
  });

  it('refleja roles nuevos de la base de datos antes de renovar el token', async () => {
    const { login, request, users } = setup();
    const pair = await login();
    users.users.get(pair.user.id)!.roles = [Role.PASSENGER, Role.DRIVER];
    const me = MeResponseSchema.parse(
      await (await request(AuthRoutes.ME, { token: pair.accessToken })).json(),
    );
    expect(me.roles).toEqual(['PASSENGER', 'DRIVER']);
  });

  it('sin token → 401 UNAUTHENTICATED; cuenta suspendida → 403', async () => {
    const { login, request, users } = setup();
    const res = await request(AuthRoutes.ME);
    expect(res.status).toBe(401);
    expect((await res.json<ErrorJson>()).error.code).toBe('UNAUTHENTICATED');

    const pair = await login();
    users.users.get(pair.user.id)!.status = 'SUSPENDED';
    const suspended = await request(AuthRoutes.ME, { token: pair.accessToken });
    expect(suspended.status).toBe(403);
    expect((await suspended.json<ErrorJson>()).error.code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('POST /me/mode', () => {
  it('conductor: driver y de vuelta a passenger, con refresh rotado que guarda el modo', async () => {
    const { login, post, users, setUnavailable } = setup();
    const first = await login();
    users.users.get(first.user.id)!.roles = [Role.PASSENGER, Role.DRIVER];

    const res = await post(AuthRoutes.ME_MODE, { mode: 'driver' }, first.accessToken);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const driver = SwitchModeResponseSchema.parse(await res.json());
    expect(driver.user).toMatchObject({ activeMode: 'driver', roles: ['PASSENGER', 'DRIVER'] });
    expect(AccessTokenClaimsSchema.parse(decodeJwt(driver.accessToken))).toMatchObject({
      activeMode: 'driver',
      roles: ['PASSENGER', 'DRIVER'],
    });
    const record = await env.KV.get<{ activeMode: string; rotated?: boolean }>(
      REFRESH_PREFIX + (await createRefreshTokenCodec().hash(driver.refreshToken)),
      'json',
    );
    expect(record?.activeMode).toBe('driver');

    // El refresh nuevo conserva el modo driver.
    const renewed = TokenPairResponseSchema.parse(
      await (await post(AuthRoutes.REFRESH, { refreshToken: driver.refreshToken })).json(),
    );
    expect(renewed.user.activeMode).toBe('driver');

    // El refresh anterior quedó rotado: usarlo revoca la sesión.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reused = await post(AuthRoutes.REFRESH, { refreshToken: first.refreshToken });
    expect(reused.status).toBe(401);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'refresh_token_reuse' }));
    warn.mockRestore();

    // Con la sesión revocada, el cambio de modo también falla.
    const closed = await post(AuthRoutes.ME_MODE, { mode: 'passenger' }, renewed.accessToken);
    expect(closed.status).toBe(401);
    expect((await closed.json<ErrorJson>()).error.code).toBe('REFRESH_TOKEN_INVALID');
    expect(setUnavailable).not.toHaveBeenCalled();
  });

  it('pasar a passenger deja al conductor no disponible', async () => {
    const { login, post, users, setUnavailable } = setup();
    const first = await login();
    users.users.get(first.user.id)!.roles = [Role.PASSENGER, Role.DRIVER];
    const driver = TokenPairResponseSchema.parse(
      await (await post(AuthRoutes.ME_MODE, { mode: 'driver' }, first.accessToken)).json(),
    );
    const res = await post(AuthRoutes.ME_MODE, { mode: 'passenger' }, driver.accessToken);
    expect(res.status).toBe(200);
    expect((await res.json<TokenPairResponse>()).user.activeMode).toBe('passenger');
    expect(setUnavailable).toHaveBeenCalledWith(first.user.id);
  });

  it('driver sin el rol DRIVER → 403 MODE_NOT_ALLOWED', async () => {
    const { login, post } = setup();
    const pair = await login();
    const res = await post(AuthRoutes.ME_MODE, { mode: 'driver' }, pair.accessToken);
    expect(res.status).toBe(403);
    expect((await res.json<ErrorJson>()).error).toEqual({
      code: 'MODE_NOT_ALLOWED',
      message: 'Esta opción no está disponible en tu modo actual o para tu cuenta.',
    });
  });

  it('con un viaje en curso → 409 MODE_CHANGE_ACTIVE_TRIP', async () => {
    const { login, post, users } = setup({ activeTrip: true });
    const pair = await login();
    users.users.get(pair.user.id)!.roles = [Role.PASSENGER, Role.DRIVER];
    const res = await post(AuthRoutes.ME_MODE, { mode: 'driver' }, pair.accessToken);
    expect(res.status).toBe(409);
    expect((await res.json<ErrorJson>()).error.code).toBe('MODE_CHANGE_ACTIVE_TRIP');
  });

  it('modo inválido → 400; sin token → 401 (antes de validar el cuerpo)', async () => {
    const { login, post } = setup();
    const pair = await login();
    const bad = await post(AuthRoutes.ME_MODE, { mode: 'admin' }, pair.accessToken);
    expect(bad.status).toBe(400);
    expect((await bad.json<ErrorJson>()).error.code).toBe('VALIDATION_ERROR');
    const anon = await post(AuthRoutes.ME_MODE, { mode: 'nada' });
    expect(anon.status).toBe(401);
  });

  it('el login sigue funcionando por la app real (sin dobles)', async () => {
    const res = await exports.default.fetch('https://api.test/me');
    expect(res.status).toBe(401);
  });
});

describe('requireRole y requireMode', () => {
  function guardedApp() {
    const app = createRouter();
    app.onError(errorHandler);
    app.notFound(notFoundHandler);
    app.use('/admin/*', requireAuth(), requireRole(Role.ADMIN));
    app.use('/ops/*', requireAuth(), requireRole(Role.ADMIN, Role.DISPATCHER));
    app.use('/driver/*', requireAuth(), requireMode(ActiveMode.DRIVER));
    app.get('/sin-auth', requireRole(Role.ADMIN), (c) => c.text('no'));
    for (const path of ['/admin/x', '/ops/x', '/driver/x']) {
      app.get(path, (c) => c.json({ userId: getActor(c).userId }));
    }
    return app;
  }

  async function token(roles: Role[], activeMode: ActiveMode = ActiveMode.PASSENGER) {
    const signer = createJoseAccessTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: 'k' });
    return (await signer.sign({ userId: USER_ID, roles, activeMode })).token;
  }

  const get = async (path: string, roles?: Role[], mode?: ActiveMode) =>
    guardedApp().request(
      path,
      { headers: roles ? { authorization: `Bearer ${await token(roles, mode)}` } : {} },
      testEnv(),
    );

  async function code(res: Response) {
    return [res.status, res.status === 200 ? 'OK' : (await res.json<ErrorJson>()).error.code];
  }

  it('requireRole: con el rol pasa; sin él → 403 FORBIDDEN', async () => {
    expect(await code(await get('/admin/x', [Role.PASSENGER, Role.ADMIN]))).toEqual([200, 'OK']);
    expect(await code(await get('/admin/x', [Role.PASSENGER, Role.DISPATCHER]))).toEqual([
      403,
      'FORBIDDEN',
    ]);
    expect(await code(await get('/ops/x', [Role.DISPATCHER]))).toEqual([200, 'OK']);
    expect(await code(await get('/ops/x', [Role.TOUR_OPERATOR]))).toEqual([403, 'FORBIDDEN']);
  });

  it('requireMode: modo distinto → 403 MODE_NOT_ALLOWED', async () => {
    const driverRoles = [Role.PASSENGER, Role.DRIVER];
    expect(await code(await get('/driver/x', driverRoles, ActiveMode.DRIVER))).toEqual([200, 'OK']);
    expect(await code(await get('/driver/x', driverRoles, ActiveMode.PASSENGER))).toEqual([
      403,
      'MODE_NOT_ALLOWED',
    ]);
  });

  it('sin requireAuth antes → 401; sin token → 401', async () => {
    expect(await code(await get('/sin-auth'))).toEqual([401, 'UNAUTHENTICATED']);
    expect(await code(await get('/admin/x'))).toEqual([401, 'UNAUTHENTICATED']);
  });
});

describe('claim rid', () => {
  it('el access token lleva el hash de su refresh token y el verificador lo expone', async () => {
    const { login } = setup();
    const pair = await login();
    const claims = decodeJwt(pair.accessToken);
    expect(claims.rid).toBe(await createRefreshTokenCodec().hash(pair.refreshToken));
    const { createJoseAccessTokenVerifier } =
      await import('../src/modules/auth/infrastructure/jose-access-tokens');
    const check = await createJoseAccessTokenVerifier({ publicKeyPem: keys.publicKeyPem }).verify(
      pair.accessToken,
    );
    expect(check).toMatchObject({ ok: true, actor: { refreshId: claims.rid } });
  });
});

describe('OpenAPI', () => {
  it('registra GET /me y POST /me/mode con bearerAuth', async () => {
    const res = await exports.default.fetch('https://api.test/openapi.json');
    const doc = await res.json<{
      paths: Record<
        string,
        Record<string, { security?: unknown; responses: Record<string, unknown> }>
      >;
    }>();
    expect(doc.paths[AuthRoutes.ME]?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths[AuthRoutes.ME_MODE]?.post?.responses).toHaveProperty('409');
    expect(doc.paths[AuthRoutes.ME_MODE]?.post?.responses).toHaveProperty('403');
  });
});
