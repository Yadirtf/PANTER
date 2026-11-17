import {
  AccessTokenClaimsSchema,
  AuthRoutes,
  JWT_AUDIENCE,
  JWT_ISSUER,
  TokenPairResponseSchema,
  type TokenPairResponse,
} from '@panter/contracts';
import { env, exports } from 'cloudflare:workers';
import {
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  importPKCS8,
  jwtVerify,
  SignJWT,
  type JSONWebKeySet,
} from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAuthFactories, requireAuth } from '../src/composition/auth';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { getActor, bearerToken } from '../src/modules/auth/http/require-auth';
import {
  buildJwks,
  createJoseAccessTokenSigner,
  createJoseAccessTokenVerifier,
  normalizePem,
} from '../src/modules/auth/infrastructure/jose-access-tokens';
import {
  createKvRefreshTokenStore,
  createRefreshTokenCodec,
  REFRESH_FAMILY_PREFIX,
  REFRESH_PREFIX,
} from '../src/modules/auth/infrastructure/refresh-tokens';
import { createRouter } from '../src/shared/http/create-app';
import { errorHandler, notFoundHandler } from '../src/shared/http/errors';
import { captureDelivery, MemoryUserRepository } from './support/auth-fakes';
import { otherKeys, testKeys, type TestKeys } from './support/jwt-keys';

const OTP_SECRET = 'test-otp-secret-0123456789abcdef0123456789abcdef';
const USER_ID = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';

let keys: TestKeys;
beforeAll(async () => {
  keys = await testKeys();
});

async function clearKv() {
  const { keys: list } = await env.KV.list();
  await Promise.all(list.map((k) => env.KV.delete(k.name)));
}
beforeEach(clearKv);
afterEach(() => vi.restoreAllMocks());

function testEnv(extra: Partial<Env> = {}): Env {
  return {
    ...env,
    OTP_SECRET,
    JWT_PRIVATE_KEY: keys.privateKeyPem,
    JWT_PUBLIC_KEY: keys.publicKeyPem,
    ...extra,
  };
}

interface ErrorJson {
  error: { code: string; message: string };
}

function setup() {
  const users = new MemoryUserRepository();
  const mail = captureDelivery();
  const app = createApp({
    auth: buildAuthFactories({ users: () => users, deliver: () => mail.deliver }),
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
  async function login(email = 'ana@panter.test'): Promise<TokenPairResponse> {
    await post(AuthRoutes.OTP_REQUEST, { email });
    const res = await post(AuthRoutes.OTP_VERIFY, { email, code: mail.lastCode(email) });
    expect(res.status).toBe(200);
    return TokenPairResponseSchema.parse(await res.json());
  }
  return { app, users, post, login };
}

describe('access token (jose, RS256)', () => {
  it('firma los claims del contrato con kid en el header y 15 min de vigencia', async () => {
    const now = Date.UTC(2026, 10, 13, 12, 0, 0);
    const signer = createJoseAccessTokenSigner({
      privateKeyPem: keys.privateKeyPem,
      kid: 'kid-1',
      now: () => now,
      newId: () => 'jti-1',
    });
    const { token, expiresIn } = await signer.sign({
      userId: USER_ID,
      roles: ['PASSENGER'],
      activeMode: 'passenger',
    });
    expect(expiresIn).toBe(900);
    expect(decodeProtectedHeader(token)).toEqual({ alg: 'RS256', kid: 'kid-1', typ: 'JWT' });
    const claims = AccessTokenClaimsSchema.parse(decodeJwt(token));
    expect(claims).toEqual({
      sub: USER_ID,
      roles: ['PASSENGER'],
      activeMode: 'passenger',
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      iat: now / 1000,
      exp: now / 1000 + 900,
      jti: 'jti-1',
    });
  });

  it('el verificador acepta el token y devuelve el actor', async () => {
    const signer = createJoseAccessTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: 'k' });
    const { token } = await signer.sign({
      userId: USER_ID,
      roles: ['PASSENGER', 'DRIVER'],
      activeMode: 'driver',
    });
    const check = await createJoseAccessTokenVerifier({ publicKeyPem: keys.publicKeyPem }).verify(
      token,
    );
    expect(check).toEqual({
      ok: true,
      actor: {
        userId: USER_ID,
        roles: ['PASSENGER', 'DRIVER'],
        activeMode: 'driver',
        tokenId: expect.any(String),
      },
    });
  });

  it('vencido → expired; firma ajena, basura o claims inválidos → invalid', async () => {
    const t0 = Date.now();
    const signer = createJoseAccessTokenSigner({
      privateKeyPem: keys.privateKeyPem,
      kid: 'k',
      now: () => t0,
    });
    const { token } = await signer.sign({
      userId: USER_ID,
      roles: ['PASSENGER'],
      activeMode: 'passenger',
    });
    const at = (ms: number) =>
      createJoseAccessTokenVerifier({ publicKeyPem: keys.publicKeyPem, now: () => ms });
    expect(await at(t0 + 14 * 60_000).verify(token)).toMatchObject({ ok: true });
    expect(await at(t0 + 16 * 60_000).verify(token)).toEqual({ ok: false, reason: 'expired' });

    const verifier = at(t0);
    const foreign = await otherKeys();
    const { token: forged } = await createJoseAccessTokenSigner({
      privateKeyPem: foreign.privateKeyPem,
      kid: 'k',
    }).sign({ userId: USER_ID, roles: ['ADMIN'], activeMode: 'passenger' });
    expect(await verifier.verify(forged)).toEqual({ ok: false, reason: 'invalid' });
    expect(await verifier.verify('no.es.jwt')).toEqual({ ok: false, reason: 'invalid' });

    // Firma correcta pero claims fuera del contrato (sub no es UUID, rol inexistente).
    const pk = await importPKCS8(keys.privateKeyPem, 'RS256');
    const bad = await new SignJWT({ roles: ['SUPERUSER'], activeMode: 'passenger' })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('nadie')
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(pk);
    expect(await verifier.verify(bad)).toEqual({ ok: false, reason: 'invalid' });

    // Otro emisor o audiencia.
    const otherAud = await new SignJWT({ roles: ['PASSENGER'], activeMode: 'passenger' })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(USER_ID)
      .setIssuer(JWT_ISSUER)
      .setAudience('otra-app')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(pk);
    expect(await verifier.verify(otherAud)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rechaza tokens sin firma (alg none) y con HS256', async () => {
    const verifier = createJoseAccessTokenVerifier({ publicKeyPem: keys.publicKeyPem });
    const b64 = (v: unknown) =>
      btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const claims = {
      sub: USER_ID,
      roles: ['ADMIN'],
      activeMode: 'passenger',
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
    expect(await verifier.verify(none)).toEqual({ ok: false, reason: 'invalid' });
    const hs = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode(keys.publicKeyPem));
    expect(await verifier.verify(hs)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('normaliza PEM pegados con \\n literales o en una sola línea', async () => {
    const oneLine = keys.publicKeyPem.replace(/\n/g, '\\n');
    const spaces = keys.publicKeyPem.replace(/\n/g, ' ');
    const crlf = keys.publicKeyPem.replace(/\n/g, '\r\n');
    const expected = normalizePem(keys.publicKeyPem, 'PUBLIC KEY');
    for (const pem of [oneLine, spaces, crlf]) {
      expect(normalizePem(pem, 'PUBLIC KEY')).toBe(expected);
    }
    expect(expected.split('\n').every((line) => line.length <= 64)).toBe(true);
    const signer = createJoseAccessTokenSigner({
      privateKeyPem: keys.privateKeyPem.replace(/\n/g, '\\n'),
      kid: 'k',
    });
    const { token } = await signer.sign({
      userId: USER_ID,
      roles: ['PASSENGER'],
      activeMode: 'passenger',
    });
    expect(
      await createJoseAccessTokenVerifier({ publicKeyPem: spaces }).verify(token),
    ).toMatchObject({ ok: true });
  });

  it('PEM con el formato equivocado: error claro', async () => {
    expect(() => normalizePem(keys.publicKeyPem, 'PRIVATE KEY')).toThrow(/JWT_PRIVATE_KEY.*PKCS8/);
    expect(() => normalizePem('basura', 'PUBLIC KEY')).toThrow(/JWT_PUBLIC_KEY.*SPKI/);
    const rsaPkcs1 = '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----';
    await expect(
      createJoseAccessTokenVerifier({ publicKeyPem: rsaPkcs1 }).verify('x.y.z'),
    ).rejects.toThrow();
  });

  it('JWKS con kid, alg y use, y verificable con createLocalJWKSet (como la web)', async () => {
    const jwks = await buildJwks(keys.publicKeyPem, 'kid-1');
    expect(jwks.keys).toEqual([
      { kty: 'RSA', n: expect.any(String), e: 'AQAB', kid: 'kid-1', alg: 'RS256', use: 'sig' },
    ]);
    const signer = createJoseAccessTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: 'kid-1' });
    const { token } = await signer.sign({
      userId: USER_ID,
      roles: ['ADMIN'],
      activeMode: 'passenger',
    });
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks as JSONWebKeySet), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    expect(payload.sub).toBe(USER_ID);
  });
});

describe('refresh tokens (KV)', () => {
  it('32 bytes aleatorios en base64url y SHA-256 en hexadecimal', async () => {
    const codec = createRefreshTokenCodec();
    const a = codec.generate();
    const b = codec.generate();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(await codec.hash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('guarda el registro bajo el hash con TTL de 30 días y revoca familias', async () => {
    const now = Date.now();
    const store = createKvRefreshTokenStore(env.KV, () => now);
    const record = {
      userId: USER_ID,
      activeMode: 'passenger' as const,
      familyId: 'fam-1',
      expiresAt: now + 30 * 86_400_000,
    };
    await store.put('h1', record);
    expect(await store.get('h1')).toEqual(record);
    const { keys: list } = await env.KV.list({ prefix: REFRESH_PREFIX });
    expect(list.map((k) => [k.name, k.expiration])).toEqual([
      [REFRESH_PREFIX + 'h1', Math.ceil(record.expiresAt / 1000)],
    ]);
    expect(await store.isFamilyRevoked('fam-1')).toBe(false);
    await store.revokeFamily('fam-1', record.expiresAt);
    expect(await store.isFamilyRevoked('fam-1')).toBe(true);
    expect((await env.KV.list({ prefix: REFRESH_FAMILY_PREFIX })).keys).toHaveLength(1);
    await store.delete('h1');
    expect(await store.get('h1')).toBeNull();
  });

  it('usa Date.now por defecto', async () => {
    const store = createKvRefreshTokenStore(env.KV);
    await store.revokeFamily('fam-x', Date.now());
    expect(await store.isFamilyRevoked('fam-x')).toBe(true);
  });
});

describe('rutas de sesión', () => {
  it('verify devuelve un par cuyo access token cumple el contrato y el JWKS lo verifica', async () => {
    const { login, app } = setup();
    const pair = await login();
    expect(pair).toMatchObject({ tokenType: 'Bearer', expiresIn: 900, refreshExpiresIn: 2592000 });
    expect(pair.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const header = decodeProtectedHeader(pair.accessToken);
    expect(header).toMatchObject({ alg: 'RS256', kid: env.JWT_KID });

    const res = await app.request(AuthRoutes.JWKS, {}, testEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    const jwks = await res.json<JSONWebKeySet>();
    const { payload } = await jwtVerify(pair.accessToken, createLocalJWKSet(jwks), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    expect(AccessTokenClaimsSchema.parse(payload)).toMatchObject({
      sub: pair.user.id,
      roles: ['PASSENGER'],
      activeMode: 'passenger',
      jti: expect.any(String),
    });
  });

  it('en KV queda solo el SHA-256 del refresh token', async () => {
    const { login } = setup();
    const pair = await login();
    const { keys: list } = await env.KV.list({ prefix: REFRESH_PREFIX });
    expect(list).toHaveLength(1);
    const hash = await createRefreshTokenCodec().hash(pair.refreshToken);
    expect(list[0]?.name).toBe(REFRESH_PREFIX + hash);
    expect(await env.KV.get(list[0]!.name)).not.toContain(pair.refreshToken);
  });

  it('POST /auth/refresh rota; reutilizar el anterior → 401 y revoca la sesión', async () => {
    const { login, post } = setup();
    const first = await login();
    const res = await post(AuthRoutes.REFRESH, { refreshToken: first.refreshToken });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const second = TokenPairResponseSchema.parse(await res.json());
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.user.id).toBe(first.user.id);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reused = await post(AuthRoutes.REFRESH, { refreshToken: first.refreshToken });
    expect(reused.status).toBe(401);
    expect((await reused.json<ErrorJson>()).error.code).toBe('REFRESH_TOKEN_INVALID');
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'refresh_token_reuse' }));

    const afterReuse = await post(AuthRoutes.REFRESH, { refreshToken: second.refreshToken });
    expect(afterReuse.status).toBe(401);
  });

  it('POST /auth/refresh con token desconocido → 401 REFRESH_TOKEN_INVALID', async () => {
    const { post } = setup();
    const res = await post(AuthRoutes.REFRESH, { refreshToken: 'desconocido' });
    expect(res.status).toBe(401);
    expect((await res.json<ErrorJson>()).error).toEqual({
      code: 'REFRESH_TOKEN_INVALID',
      message: 'Tu sesión ya no es válida. Ingresa de nuevo con tu correo.',
    });
  });

  it('POST /auth/logout responde 204 y revoca el refresh', async () => {
    const { login, post } = setup();
    const pair = await login();
    const res = await post(AuthRoutes.LOGOUT, { refreshToken: pair.refreshToken });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    const refresh = await post(AuthRoutes.REFRESH, { refreshToken: pair.refreshToken });
    expect(refresh.status).toBe(401);
    expect((await post(AuthRoutes.LOGOUT, { refreshToken: pair.refreshToken })).status).toBe(204);
  });

  it('400 si falta el refreshToken', async () => {
    const { post } = setup();
    expect((await post(AuthRoutes.REFRESH, {})).status).toBe(400);
    expect((await post(AuthRoutes.LOGOUT, { refreshToken: '' })).status).toBe(400);
  });

  it('sin llaves JWT: verify falla con log claro sin gastar el código; /health sigue en 200', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    await s.post(AuthRoutes.OTP_REQUEST, { email: 'ana@panter.test' });
    const res = await s.post(
      AuthRoutes.OTP_VERIFY,
      { email: 'ana@panter.test', code: '123456' },
      { JWT_PRIVATE_KEY: undefined },
    );
    expect(res.status).toBe(500);
    expect(String(error.mock.calls[0]?.[1])).toMatch(/secreto JWT_PRIVATE_KEY/);
    const jwks = await s.app.request(AuthRoutes.JWKS, {}, testEnv({ JWT_PUBLIC_KEY: undefined }));
    expect(jwks.status).toBe(500);
    const kid = await s.app.request(AuthRoutes.JWKS, {}, testEnv({ JWT_KID: '' }));
    expect(kid.status).toBe(500);
    expect(String(error.mock.calls.at(-1)?.[1])).toMatch(/var JWT_KID/);
    expect((await exports.default.fetch('https://api.test/health')).status).toBe(200);
  });

  it('OpenAPI registra refresh, logout, JWKS y el esquema bearerAuth', async () => {
    const res = await exports.default.fetch('https://api.test/openapi.json');
    const doc = await res.json<{
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { securitySchemes?: Record<string, unknown> };
    }>();
    expect(doc.paths[AuthRoutes.REFRESH]?.post?.responses).toHaveProperty('401');
    expect(doc.paths[AuthRoutes.LOGOUT]?.post?.responses).toHaveProperty('204');
    expect(doc.paths[AuthRoutes.JWKS]?.get?.responses).toHaveProperty('200');
    expect(doc.paths[AuthRoutes.OTP_VERIFY]?.post?.responses).toHaveProperty('200');
    expect(doc.components.securitySchemes).toHaveProperty('bearerAuth');
  });
});

describe('requireAuth', () => {
  function protectedApp() {
    const app = createRouter();
    app.onError(errorHandler);
    app.notFound(notFoundHandler);
    app.use('/privado/*', requireAuth());
    app.get('/privado/yo', (c) => c.json(getActor(c)));
    app.get('/sin-middleware', (c) => c.json(getActor(c)));
    return app;
  }

  async function tokenAt(now: number) {
    const signer = createJoseAccessTokenSigner({
      privateKeyPem: keys.privateKeyPem,
      kid: 'k',
      now: () => now,
    });
    return (await signer.sign({ userId: USER_ID, roles: ['PASSENGER'], activeMode: 'passenger' }))
      .token;
  }

  const get = (path: string, authorization?: string) =>
    protectedApp().request(path, { headers: authorization ? { authorization } : {} }, testEnv());

  it('con Bearer válido pone el actor en el contexto', async () => {
    const res = await get('/privado/yo', `Bearer ${await tokenAt(Date.now())}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      userId: USER_ID,
      roles: ['PASSENGER'],
      activeMode: 'passenger',
    });
    // El esquema no distingue mayúsculas.
    expect((await get('/privado/yo', `bearer ${await tokenAt(Date.now())}`)).status).toBe(200);
  });

  it('sin token o mal formado → 401 UNAUTHENTICATED', async () => {
    for (const header of [undefined, 'Basic abc', 'Bearer', 'Bearer a b', 'Bearer no.es.jwt']) {
      const res = await get('/privado/yo', header);
      expect(res.status).toBe(401);
      expect((await res.json<ErrorJson>()).error).toEqual({
        code: 'UNAUTHENTICATED',
        message: 'Inicia sesión para continuar.',
      });
    }
  });

  it('token vencido → 401 TOKEN_EXPIRED', async () => {
    const res = await get('/privado/yo', `Bearer ${await tokenAt(Date.now() - 20 * 60_000)}`);
    expect(res.status).toBe(401);
    expect((await res.json<ErrorJson>()).error.code).toBe('TOKEN_EXPIRED');
  });

  it('firmado con otra llave → 401 UNAUTHENTICATED', async () => {
    const foreign = await otherKeys();
    const { token } = await createJoseAccessTokenSigner({
      privateKeyPem: foreign.privateKeyPem,
      kid: 'k',
    }).sign({ userId: USER_ID, roles: ['ADMIN'], activeMode: 'passenger' });
    const res = await get('/privado/yo', `Bearer ${token}`);
    expect((await res.json<ErrorJson>()).error.code).toBe('UNAUTHENTICATED');
  });

  it('el access token del login sirve en una ruta protegida', async () => {
    const { login } = setup();
    const pair = await login();
    const res = await get('/privado/yo', `Bearer ${pair.accessToken}`);
    expect(await res.json()).toMatchObject({ userId: pair.user.id, activeMode: 'passenger' });
  });

  it('getActor sin requireAuth → 401', async () => {
    expect((await get('/sin-middleware')).status).toBe(401);
  });

  it('bearerToken extrae el token', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('  Bearer abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});
