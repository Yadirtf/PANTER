// HU-109: POST /me/consent, GET /privacy-policy, `consent` en /me y en las respuestas de sesión,
// y el middleware requireConsent() dentro de workerd.
import {
  AuthRoutes,
  ConsentRoutes,
  ConsentStatusSchema,
  MeResponseSchema,
  PRIVACY_POLICY,
  PRIVACY_POLICY_VERSION,
  PrivacyPolicyResponseSchema,
  Role,
  TokenPairResponseSchema,
  type TokenPairResponse,
} from '@panter/contracts';
import { env, exports } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildAuthFactories, requireAuth } from '../src/composition/auth';
import { buildConsentFactories, requireConsent } from '../src/composition/consent';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { makeGetConsentStatus } from '../src/modules/consent/application/consent';
import { makeRequireConsent } from '../src/modules/consent/http/require-consent';
import { createRouter } from '../src/shared/http/create-app';
import { errorHandler, notFoundHandler } from '../src/shared/http/errors';
import { captureDelivery, MemoryUserRepository } from './support/auth-fakes';
import { MemoryConsentRepository } from './support/consent-fakes';
import { testKeys, type TestKeys } from './support/jwt-keys';

const OTP_SECRET = 'test-otp-secret-0123456789abcdef0123456789abcdef';

let keys: TestKeys;
beforeAll(async () => {
  keys = await testKeys();
});
beforeEach(async () => {
  const { keys: list } = await env.KV.list();
  await Promise.all(list.map((k) => env.KV.delete(k.name)));
});

const testEnv = (): Env => ({
  ...env,
  OTP_SECRET,
  JWT_PRIVATE_KEY: keys.privateKeyPem,
  JWT_PUBLIC_KEY: keys.publicKeyPem,
});

interface ErrorJson {
  error: { code: string; message: string; details?: unknown };
}

function setup() {
  const users = new MemoryUserRepository();
  const consents = new MemoryConsentRepository();
  const mail = captureDelivery();
  const app = createApp({
    auth: buildAuthFactories({
      users: () => users,
      deliver: () => mail.deliver,
      consent: () => makeGetConsentStatus({ repo: consents }),
    }),
    consent: buildConsentFactories({ repo: () => consents }),
  });
  const request = (
    path: string,
    init: {
      method?: string;
      body?: unknown;
      token?: string;
      headers?: Record<string, string>;
    } = {},
  ) => {
    const headers = new Headers(init.headers);
    if (init.token) headers.set('authorization', `Bearer ${init.token}`);
    if (init.body !== undefined) headers.set('content-type', 'application/json');
    return app.request(
      path,
      {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      },
      testEnv(),
    );
  };
  async function login(email = 'ana@panter.test'): Promise<TokenPairResponse> {
    await request(AuthRoutes.OTP_REQUEST, { body: { email } });
    const res = await request(AuthRoutes.OTP_VERIFY, {
      body: { email, code: mail.lastCode(email) },
    });
    expect(res.status).toBe(200);
    return TokenPairResponseSchema.parse(await res.json());
  }
  return { users, consents, request, login };
}

describe('consent en el perfil', () => {
  it('login, /me, refresh y cambio de modo incluyen consent; aceptar lo resuelve', async () => {
    const { login, request, consents, users } = setup();
    const pair = await login();
    expect(pair.user.consent).toEqual({
      currentVersion: PRIVACY_POLICY_VERSION,
      acceptedVersion: null,
      acceptedAt: null,
      required: true,
    });

    const res = await request(ConsentRoutes.ME_CONSENT, {
      token: pair.accessToken,
      body: { version: PRIVACY_POLICY_VERSION, accepted: true },
      headers: { 'CF-Connecting-IP': '190.85.1.2', 'User-Agent': 'PANTER-app/1.0 (Android)' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const status = ConsentStatusSchema.parse(await res.json());
    expect(status).toMatchObject({ acceptedVersion: PRIVACY_POLICY_VERSION, required: false });
    expect(consents.accepted[0]).toMatchObject({
      userId: pair.user.id,
      ip: '190.85.1.2',
      userAgent: 'PANTER-app/1.0 (Android)',
    });

    const me = MeResponseSchema.parse(
      await (await request(AuthRoutes.ME, { token: pair.accessToken })).json(),
    );
    expect(me.consent).toEqual(status);

    const refreshed = TokenPairResponseSchema.parse(
      await (
        await request(AuthRoutes.REFRESH, { body: { refreshToken: pair.refreshToken } })
      ).json(),
    );
    expect(refreshed.user.consent?.required).toBe(false);

    users.users.get(pair.user.id)!.roles = [Role.PASSENGER, Role.DRIVER];
    const switched = TokenPairResponseSchema.parse(
      await (
        await request(AuthRoutes.ME_MODE, {
          token: refreshed.accessToken,
          body: { mode: 'driver' },
        })
      ).json(),
    );
    expect(switched.user.consent?.required).toBe(false);
  });

  it('versión vieja → 409 CONSENT_VERSION_OUTDATED; accepted false → 400; sin token → 401', async () => {
    const { login, request } = setup();
    const pair = await login();
    const old = await request(ConsentRoutes.ME_CONSENT, {
      token: pair.accessToken,
      body: { version: '2020-01-v0', accepted: true },
    });
    expect(old.status).toBe(409);
    const body = await old.json<ErrorJson>();
    expect(body.error.code).toBe('CONSENT_VERSION_OUTDATED');
    expect(body.error.details).toEqual({ currentVersion: PRIVACY_POLICY_VERSION });

    const refused = await request(ConsentRoutes.ME_CONSENT, {
      token: pair.accessToken,
      body: { version: PRIVACY_POLICY_VERSION, accepted: false },
    });
    expect(refused.status).toBe(400);

    const anon = await request(ConsentRoutes.ME_CONSENT, {
      body: { version: PRIVACY_POLICY_VERSION, accepted: true },
    });
    expect(anon.status).toBe(401);
  });

  it('el consentimiento no bloquea otros endpoints todavía', async () => {
    const { login, request } = setup();
    const pair = await login();
    expect(pair.user.consent?.required).toBe(true);
    expect((await request(AuthRoutes.ME, { token: pair.accessToken })).status).toBe(200);
  });
});

describe('GET /privacy-policy', () => {
  it('es público y devuelve la versión vigente (con CORS)', async () => {
    const res = await exports.default.fetch('https://api.test/privacy-policy', {
      headers: { Origin: 'https://otro-sitio.test' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(PrivacyPolicyResponseSchema.parse(await res.json())).toEqual({
      version: PRIVACY_POLICY.version,
      effectiveFrom: PRIVACY_POLICY.effectiveFrom,
    });
  });
});

describe('requireConsent()', () => {
  function guarded(consents: MemoryConsentRepository) {
    const app = createRouter();
    app.onError(errorHandler);
    app.notFound(notFoundHandler);
    const consentGuard = makeRequireConsent(() => makeGetConsentStatus({ repo: consents }));
    app.use('/trips/*', requireAuth(), consentGuard());
    app.get('/trips/x', (c) => c.text('ok'));
    return app;
  }

  it('sin aceptar → 403 CONSENT_REQUIRED; tras aceptar pasa', async () => {
    const { login } = setup();
    const pair = await login();
    const consents = new MemoryConsentRepository();
    const app = guarded(consents);
    const get = () =>
      app.request(
        '/trips/x',
        { headers: { authorization: `Bearer ${pair.accessToken}` } },
        testEnv(),
      );

    const blocked = await get();
    expect(blocked.status).toBe(403);
    const body = await blocked.json<ErrorJson>();
    expect(body.error).toMatchObject({
      code: 'CONSENT_REQUIRED',
      details: { currentVersion: PRIVACY_POLICY_VERSION },
    });

    await consents.accept({
      userId: pair.user.id,
      version: PRIVACY_POLICY_VERSION,
      ip: null,
      userAgent: null,
    });
    const ok = await get();
    expect(ok.status).toBe(200);
  });

  it('la versión armada en composition existe (usa Postgres)', () => {
    expect(typeof requireConsent()).toBe('function');
  });
});

describe('OpenAPI', () => {
  it('registra /me/consent (bearerAuth) y /privacy-policy (público)', async () => {
    const res = await exports.default.fetch('https://api.test/openapi.json');
    const doc = await res.json<{
      paths: Record<string, Record<string, { security?: unknown; responses: object }>>;
    }>();
    expect(doc.paths[ConsentRoutes.ME_CONSENT]?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths[ConsentRoutes.ME_CONSENT]?.post?.responses).toHaveProperty('409');
    expect(doc.paths[ConsentRoutes.PRIVACY_POLICY]?.get?.security).toBeUndefined();
  });
});
