import {
  ApiErrorCode,
  AuthRoutes,
  MeResponseSchema,
  OTP_MAX_CODES_PER_WINDOW,
  OtpRequestResponseSchema,
} from '@panter/contracts';
import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAuthFactories, type AuthOverrides } from '../src/composition/auth';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { createHmacOtpHasher } from '../src/modules/auth/infrastructure/hmac-otp-hasher';
import {
  createKvOtpStore,
  kvExpiration,
  OTP_CODE_PREFIX,
  OTP_RATE_PREFIX,
} from '../src/modules/auth/infrastructure/kv-otp-store';
import { BREVO_API_URL } from '../src/modules/email/infrastructure/brevo-email-sender';
import { captureDelivery, MemoryUserRepository } from './support/auth-fakes';

const OTP_SECRET = 'test-otp-secret-0123456789abcdef0123456789abcdef';

/** Borra todo el KV simulado entre pruebas (Miniflare lo comparte dentro del archivo). */
async function clearKv() {
  const { keys } = await env.KV.list();
  await Promise.all(keys.map((k) => env.KV.delete(k.name)));
}

function testEnv(extra: Partial<Env> = {}): Env {
  return { ...env, OTP_SECRET, ...extra };
}

function setup(overrides: AuthOverrides = {}) {
  const users = new MemoryUserRepository();
  const mail = captureDelivery();
  const app = createApp({
    auth: buildAuthFactories({ users: () => users, deliver: () => mail.deliver, ...overrides }),
  });
  const post = (path: string, body: unknown, extra: Partial<Env> = {}) =>
    app.request(
      path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      testEnv(extra),
    );
  return { app, users, mail, post };
}

beforeEach(clearKv);

describe('adaptadores', () => {
  it('HMAC-SHA256 con WebCrypto (vector conocido)', async () => {
    const hasher = createHmacOtpHasher('key');
    expect(await hasher.hmac('The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });

  it('KV: guarda, lee y borra código y ventana con prefijos', async () => {
    const now = Date.now();
    const store = createKvOtpStore(env.KV, () => now);
    await store.putCode('k1', { hash: 'abc', attempts: 2, expiresAt: now + 300_000 });
    await store.putRequestWindow('k1', { count: 1, resetAt: now + 900_000 });
    expect(await store.getCode('k1')).toEqual({
      hash: 'abc',
      attempts: 2,
      expiresAt: now + 300_000,
    });
    expect(await store.getRequestWindow('k1')).toEqual({ count: 1, resetAt: now + 900_000 });
    const { keys } = await env.KV.list();
    expect(keys.map((k) => k.name).sort()).toEqual([
      OTP_CODE_PREFIX + 'k1',
      OTP_RATE_PREFIX + 'k1',
    ]);
    const code = keys.find((k) => k.name.startsWith(OTP_CODE_PREFIX));
    expect(code?.expiration).toBe(Math.ceil((now + 300_000) / 1000));
    await store.deleteCode('k1');
    expect(await store.getCode('k1')).toBeNull();
    expect(await store.getCode('otra')).toBeNull();
  });

  it('KV: la expiración nunca queda a menos de 60 s (mínimo de KV)', () => {
    const now = 1_000_000_000_000;
    expect(kvExpiration(now + 10_000, now)).toBe((now + 60_000) / 1000);
    expect(kvExpiration(now + 300_000, now)).toBe((now + 300_000) / 1000);
    expect(kvExpiration(now - 5_000, now)).toBe((now + 60_000) / 1000);
  });

  it('KV: actualizar intentos con poco tiempo restante no falla', async () => {
    const now = Date.now();
    const store = createKvOtpStore(env.KV);
    await store.putCode('k2', { hash: 'x', attempts: 1, expiresAt: now + 5_000 });
    expect(await store.getCode('k2')).toMatchObject({ attempts: 1 });
  });
});

describe('POST /auth/otp/request', () => {
  it('responde 202 con el cuerpo del contrato y envía el código', async () => {
    const { post, mail } = setup();
    const res = await post(AuthRoutes.OTP_REQUEST, { email: '  Ana@Panter.TEST ' });
    expect(res.status).toBe(202);
    expect(OtpRequestResponseSchema.parse(await res.json())).toEqual({
      status: 'sent',
      expiresInSeconds: 300,
      resendAfterSeconds: 60,
    });
    // El correo llega normalizado por EmailSchema.
    expect(mail.sent).toEqual([
      { email: 'ana@panter.test', code: expect.stringMatching(/^\d{6}$/) },
    ]);
  });

  it('en KV no queda el correo ni el código en claro', async () => {
    const { post, mail } = setup();
    await post(AuthRoutes.OTP_REQUEST, { email: 'ana@panter.test' });
    const code = mail.lastCode('ana@panter.test')!;
    const { keys } = await env.KV.list();
    expect(keys).toHaveLength(2);
    for (const { name } of keys) {
      expect(name).not.toContain('ana');
      const value = (await env.KV.get(name))!;
      expect(value).not.toContain('ana');
      expect(value).not.toContain(code);
    }
  });

  it('misma respuesta exista o no la cuenta', async () => {
    const { post, users } = setup();
    users.add('existe@panter.test');
    const a = await post(AuthRoutes.OTP_REQUEST, { email: 'existe@panter.test' });
    const b = await post(AuthRoutes.OTP_REQUEST, { email: 'nadie@panter.test' });
    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());
  });

  it('429 OTP_RATE_LIMITED con Retry-After al pasar el límite', async () => {
    const { post } = setup();
    for (let i = 0; i < OTP_MAX_CODES_PER_WINDOW; i++) {
      expect((await post(AuthRoutes.OTP_REQUEST, { email: 'ana@panter.test' })).status).toBe(202);
    }
    const res = await post(AuthRoutes.OTP_REQUEST, { email: 'ana@panter.test' });
    expect(res.status).toBe(429);
    const body = await res.json<{
      error: { code: string; details: { retryAfterSeconds: number } };
    }>();
    expect(body.error.code).toBe(ApiErrorCode.OTP_RATE_LIMITED);
    expect(Number(res.headers.get('Retry-After'))).toBe(body.error.details.retryAfterSeconds);
    expect(body.error.details.retryAfterSeconds).toBeGreaterThan(890);
  });

  it('400 VALIDATION_ERROR con un correo inválido', async () => {
    const { post, mail } = setup();
    const res = await post(AuthRoutes.OTP_REQUEST, { email: 'no-es-correo' });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('VALIDATION_ERROR');
    expect(mail.sent).toEqual([]);
  });

  it('503 EMAIL_DELIVERY_FAILED si el correo no sale', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { post } = setup({ deliver: () => () => Promise.reject(new Error('brevo 401')) });
    const res = await post(AuthRoutes.OTP_REQUEST, { email: 'ana@panter.test' });
    expect(res.status).toBe(503);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe(
      'EMAIL_DELIVERY_FAILED',
    );
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'otp_delivery_failed', error: 'brevo 401' }),
    );
    error.mockRestore();
  });
});

describe('POST /auth/otp/verify', () => {
  async function requestCode(s: ReturnType<typeof setup>, email = 'ana@panter.test') {
    await s.post(AuthRoutes.OTP_REQUEST, { email });
    return s.mail.lastCode(email)!;
  }

  it('crea la cuenta PASSENGER y devuelve el perfil del contrato', async () => {
    const s = setup();
    const code = await requestCode(s);
    const res = await s.post(AuthRoutes.OTP_VERIFY, { email: 'ANA@panter.test', code });
    expect(res.status).toBe(200);
    const profile = MeResponseSchema.parse(await res.json());
    expect(profile).toMatchObject({
      email: 'ana@panter.test',
      roles: ['PASSENGER'],
      activeMode: 'passenger',
      status: 'ACTIVE',
    });
    expect(s.users.created).toBe(1);
  });

  it('el código se borra al verificarse (un solo uso)', async () => {
    const s = setup();
    const code = await requestCode(s);
    expect((await s.post(AuthRoutes.OTP_VERIFY, { email: 'ana@panter.test', code })).status).toBe(
      200,
    );
    const again = await s.post(AuthRoutes.OTP_VERIFY, { email: 'ana@panter.test', code });
    expect(again.status).toBe(400);
    expect((await again.json<{ error: { code: string } }>()).error.code).toBe('OTP_EXPIRED');
  });

  it('OTP_INVALID y, al 5.º fallo, OTP_TOO_MANY_ATTEMPTS', async () => {
    const s = setup();
    const code = await requestCode(s);
    const wrong = code === '000000' ? '000001' : '000000';
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await s.post(AuthRoutes.OTP_VERIFY, { email: 'ana@panter.test', code: wrong });
      codes.push((await res.json<{ error: { code: string } }>()).error.code);
    }
    expect(codes).toEqual([
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_TOO_MANY_ATTEMPTS',
    ]);
    const res = await s.post(AuthRoutes.OTP_VERIFY, { email: 'ana@panter.test', code });
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('OTP_EXPIRED');
  });

  it('403 ACCOUNT_SUSPENDED para cuentas suspendidas', async () => {
    const s = setup();
    s.users.add('ana@panter.test', 'SUSPENDED');
    const code = await requestCode(s);
    const res = await s.post(AuthRoutes.OTP_VERIFY, { email: 'ana@panter.test', code });
    expect(res.status).toBe(403);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('400 VALIDATION_ERROR si el código no tiene 6 dígitos', async () => {
    const s = setup();
    const res = await s.post(AuthRoutes.OTP_VERIFY, { email: 'ana@panter.test', code: '12a' });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('configuración', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sin OTP_SECRET el login responde 500 con log claro y /health sigue en 200', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await exports.default.fetch(`https://api.test${AuthRoutes.OTP_REQUEST}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ana@panter.test' }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' },
    });
    expect(String(error.mock.calls[0]?.[1])).toMatch(/secreto OTP_SECRET/);
    expect((await exports.default.fetch('https://api.test/health')).status).toBe(200);
  });

  it('OTP_SECRET demasiado corto es un error claro', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { post } = setup();
    const res = await post(
      AuthRoutes.OTP_REQUEST,
      { email: 'a@panter.test' },
      { OTP_SECRET: 'corto' },
    );
    expect(res.status).toBe(500);
    expect(String(error.mock.calls[0]?.[1])).toMatch(/openssl rand -hex 32/);
  });

  it('con la composición real y Brevo simulado: eco en staging, nunca en production', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(null, { status: 201 }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const users = new MemoryUserRepository();
    const app = createApp({ auth: buildAuthFactories({ users: () => users }) });
    const emailEnv = {
      EMAIL_FROM: 'panter@gmail.com',
      BREVO_API_KEY: 'xkeysib-test',
      OTP_DEV_ECHO: 'true',
      OTP_DEV_ECHO_ALLOWLIST: 'tester@gmail.com',
    };
    const request = (ENVIRONMENT: string) =>
      app.request(
        AuthRoutes.OTP_REQUEST,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'tester@gmail.com' }),
        },
        testEnv({ ...emailEnv, ENVIRONMENT }),
      );

    expect((await request('production')).status).toBe(202);
    expect(log.mock.calls.filter(([e]) => JSON.stringify(e).includes('otp_dev_echo'))).toEqual([]);

    await clearKv();
    expect((await request('staging')).status).toBe(202);
    const echoes = log.mock.calls.filter(([e]) => JSON.stringify(e).includes('otp_dev_echo'));
    expect(echoes).toEqual([
      [{ event: 'otp_dev_echo', to: 'tester@gmail.com', code: expect.stringMatching(/^\d{6}$/) }],
    ]);

    // Ambos enviaron el correo por Brevo con el asunto de la plantilla.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, init] = fetchSpy.mock.calls[1]!;
    expect(url).toBe(BREVO_API_URL);
    const sent = JSON.parse(String((init as RequestInit).body)) as { subject: string };
    expect(sent.subject).toMatch(/^Tu código PANTER es \d{6}$/);
  });
});

describe('OpenAPI', () => {
  it('registra /auth/otp/request y /auth/otp/verify', async () => {
    const res = await exports.default.fetch('https://api.test/openapi.json');
    const doc = await res.json<{
      paths: Record<string, { post?: { responses: Record<string, unknown> } }>;
    }>();
    expect(doc.paths[AuthRoutes.OTP_REQUEST]?.post?.responses).toHaveProperty('202');
    expect(doc.paths[AuthRoutes.OTP_REQUEST]?.post?.responses).toHaveProperty('429');
    expect(doc.paths[AuthRoutes.OTP_VERIFY]?.post?.responses).toHaveProperty('200');
    expect(doc.paths[AuthRoutes.OTP_VERIFY]?.post?.responses).toHaveProperty('403');
  });
});
