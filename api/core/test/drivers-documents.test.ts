// HU-202: URL firmada y PUT de documentos dentro de workerd, con R2 y KV de Miniflare.
import {
  DocumentUploadUrlResponseSchema,
  DriverDocumentSchema,
  DriverProfileSchema,
  DriverRoutes,
  documentUploadUrlPath,
  PRIVACY_POLICY,
  Role,
} from '@panter/contracts';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAuthFactories } from '../src/composition/auth';
import { buildConsentFactories } from '../src/composition/consent';
import { buildDriverFactories, requireDocumentUrlSecret } from '../src/composition/drivers';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { createJoseAccessTokenSigner } from '../src/modules/auth/infrastructure/jose-access-tokens';
import { UPLOAD_USED_PREFIX } from '../src/modules/drivers/infrastructure/kv-upload-ledger';
import { MemoryUserRepository } from './support/auth-fakes';
import { MemoryConsentRepository } from './support/consent-fakes';
import { IMAGES, MemoryDriverRepository } from './support/driver-fakes';
import { testKeys, type TestKeys } from './support/jwt-keys';

const DOCUMENT_URL_SECRET = 'test-document-url-secret-0123456789abcdef0123456789';

let keys: TestKeys;
beforeAll(async () => {
  keys = await testKeys();
});
beforeEach(async () => {
  const { keys: list } = await env.KV.list();
  await Promise.all(list.map((k) => env.KV.delete(k.name)));
  const objects = await env.DOCUMENTS.list();
  await Promise.all(objects.objects.map((o) => env.DOCUMENTS.delete(o.key)));
});

const testEnv = (over: Partial<Env> = {}): Env => ({
  ...env,
  JWT_PUBLIC_KEY: keys.publicKeyPem,
  DOCUMENT_URL_SECRET,
  ...over,
});

interface ErrorJson {
  error: { code: string; message: string };
}

function setup() {
  const users = new MemoryUserRepository();
  const drivers = new MemoryDriverRepository();
  const consents = new MemoryConsentRepository();
  const app = createApp({
    auth: buildAuthFactories({ users: () => users }),
    consent: buildConsentFactories({ repo: () => consents }),
    drivers: buildDriverFactories({ repo: () => drivers }),
  });
  const ana = users.add('ana@villagarzon.test');
  async function bearer() {
    const signer = createJoseAccessTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: 'k' });
    const { token } = await signer.sign({
      userId: ana.id,
      roles: [Role.PASSENGER],
      activeMode: 'passenger',
    });
    return `Bearer ${token}`;
  }
  async function uploadUrl(
    type: Parameters<typeof documentUploadUrlPath>[0],
    body: unknown,
    over?: Partial<Env>,
  ) {
    return app.request(
      `https://api.test${documentUploadUrlPath(type)}`,
      {
        method: 'POST',
        headers: { authorization: await bearer(), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      testEnv(over),
    );
  }
  function put(url: string, bytes: Uint8Array, headers: Record<string, string> = {}) {
    return app.request(
      url,
      { method: 'PUT', headers: { 'content-type': 'image/jpeg', ...headers }, body: bytes },
      testEnv(),
    );
  }
  async function getMe() {
    return app.request(DriverRoutes.ME, { headers: { authorization: await bearer() } }, testEnv());
  }
  async function accept() {
    await consents.accept({
      userId: ana.id,
      version: PRIVACY_POLICY.version,
      ip: null,
      userAgent: null,
    });
  }
  return { app, drivers, ana, uploadUrl, put, getMe, accept };
}

async function codeOf(res: Response) {
  return [res.status, (await res.json<ErrorJson>()).error.code];
}

describe('POST /drivers/me/documents/:type/upload-url + PUT firmado', () => {
  it('sube la cédula a R2 privado con metadatos y la deja SUBMITTED; la URL es de un solo uso', async () => {
    const { drivers, ana, uploadUrl, put, getMe, accept } = setup();
    await accept();
    drivers.seed(ana.id);
    const bytes = IMAGES['image/jpeg']();
    const res = await uploadUrl('CEDULA', { contentType: 'image/jpeg', sizeBytes: bytes.length });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const grant = DocumentUploadUrlResponseSchema.parse(await res.json());
    expect(grant.uploadUrl.startsWith('https://api.test/drivers/documents/upload?token=')).toBe(
      true,
    );

    // Sin Bearer: la firma es la autorización.
    const uploaded = await put(grant.uploadUrl, bytes);
    expect(uploaded.status).toBe(200);
    const doc = DriverDocumentSchema.parse(await uploaded.json());
    expect(doc).toMatchObject({ type: 'CEDULA', status: 'SUBMITTED', sizeBytes: bytes.length });

    const key = drivers.documents.get(`${ana.id}:CEDULA`)!.r2Key;
    expect(key).toMatch(new RegExp(`^drivers/${ana.id}/CEDULA/[0-9a-f-]{36}$`));
    const object = await env.DOCUMENTS.get(key);
    expect(object?.httpMetadata?.contentType).toBe('image/jpeg');
    expect(object?.customMetadata).toEqual({ userId: ana.id, type: 'CEDULA' });
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(bytes);
    expect(await env.KV.get(UPLOAD_USED_PREFIX + key)).toBe('1');

    expect(await codeOf(await put(grant.uploadUrl, bytes))).toEqual([403, 'UPLOAD_URL_INVALID']);

    const me = DriverProfileSchema.parse(await (await getMe()).json());
    expect(me.documents.map((d) => d.type)).toEqual(['CEDULA']);
    expect(me.missingDocuments).not.toContain('CEDULA');
  });

  it('el PUT corta el cuerpo en maxBytes aunque Content-Length no lo diga → 413', async () => {
    const { drivers, ana, uploadUrl, put, accept } = setup();
    await accept();
    drivers.seed(ana.id);
    const grant = DocumentUploadUrlResponseSchema.parse(
      await (await uploadUrl('SOAT', { contentType: 'image/jpeg', sizeBytes: 12 })).json(),
    );
    const tooBig = new Uint8Array(64);
    tooBig.set(IMAGES['image/jpeg']());
    expect(await codeOf(await put(grant.uploadUrl, tooBig))).toEqual([413, 'DOCUMENT_TOO_LARGE']);
    expect((await env.DOCUMENTS.list()).objects).toHaveLength(0);
  });

  it('magic bytes de PDF con Content-Type image/jpeg → 415; Content-Type distinto → 415', async () => {
    const { drivers, ana, uploadUrl, put, accept } = setup();
    await accept();
    drivers.seed(ana.id);
    const grant = DocumentUploadUrlResponseSchema.parse(
      await (await uploadUrl('LICENCIA', { contentType: 'image/jpeg', sizeBytes: 100 })).json(),
    );
    expect(await codeOf(await put(grant.uploadUrl, new TextEncoder().encode('%PDF-1.7')))).toEqual([
      415,
      'DOCUMENT_TYPE_NOT_ALLOWED',
    ]);
    expect(
      await codeOf(
        await put(grant.uploadUrl, IMAGES['image/png'](), { 'content-type': 'image/png' }),
      ),
    ).toEqual([415, 'DOCUMENT_TYPE_NOT_ALLOWED']);
  });

  it('URL alterada → 403 UPLOAD_URL_INVALID', async () => {
    const { drivers, ana, uploadUrl, put, accept } = setup();
    await accept();
    drivers.seed(ana.id);
    const grant = DocumentUploadUrlResponseSchema.parse(
      await (await uploadUrl('SOAT', { contentType: 'image/jpeg', sizeBytes: 100 })).json(),
    );
    const tampered = grant.uploadUrl.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect(await codeOf(await put(tampered, IMAGES['image/jpeg']()))).toEqual([
      403,
      'UPLOAD_URL_INVALID',
    ]);
    expect(
      await codeOf(await put('https://api.test/drivers/documents/upload', IMAGES['image/jpeg']())),
    ).toEqual([403, 'UPLOAD_URL_INVALID']);
  });

  it('errores de upload-url: tipo de documento inválido → 400; PDF → 415; 9 MB → 413', async () => {
    const { drivers, ana, uploadUrl, accept } = setup();
    await accept();
    drivers.seed(ana.id);
    expect(
      (await uploadUrl('PASAPORTE' as 'SOAT', { contentType: 'image/jpeg', sizeBytes: 1 })).status,
    ).toBe(400);
    expect(
      await codeOf(await uploadUrl('SOAT', { contentType: 'application/pdf', sizeBytes: 10 })),
    ).toEqual([415, 'DOCUMENT_TYPE_NOT_ALLOWED']);
    expect(
      await codeOf(
        await uploadUrl('SOAT', { contentType: 'image/jpeg', sizeBytes: 9 * 1024 ** 2 }),
      ),
    ).toEqual([413, 'DOCUMENT_TOO_LARGE']);
  });

  it('sin solicitud → 404; aprobado → 409; sin consentimiento → 403', async () => {
    const { drivers, ana, uploadUrl, accept } = setup();
    const body = { contentType: 'image/jpeg', sizeBytes: 10 };
    expect(await codeOf(await uploadUrl('SOAT', body))).toEqual([403, 'CONSENT_REQUIRED']);
    await accept();
    expect(await codeOf(await uploadUrl('SOAT', body))).toEqual([404, 'DRIVER_NOT_APPLIED']);
    drivers.seed(ana.id, 'APPROVED');
    expect(await codeOf(await uploadUrl('SOAT', body))).toEqual([409, 'INVALID_DRIVER_TRANSITION']);
  });

  it('sin DOCUMENT_URL_SECRET → 500 con log claro; /health sigue funcionando', async () => {
    const { app, drivers, ana, uploadUrl, accept } = setup();
    await accept();
    drivers.seed(ana.id);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await uploadUrl(
      'SOAT',
      { contentType: 'image/jpeg', sizeBytes: 10 },
      { DOCUMENT_URL_SECRET: undefined },
    );
    expect(await codeOf(res)).toEqual([500, 'INTERNAL_ERROR']);
    expect(JSON.stringify(log.mock.calls)).toContain('DOCUMENT_URL_SECRET');
    log.mockRestore();
    expect(
      (await app.request('/health', {}, testEnv({ DOCUMENT_URL_SECRET: undefined }))).status,
    ).toBe(200);
  });

  it('requireDocumentUrlSecret exige al menos 32 caracteres', () => {
    expect(() => requireDocumentUrlSecret({ DOCUMENT_URL_SECRET: 'corto' })).toThrow(
      /openssl rand -hex 32/,
    );
    expect(requireDocumentUrlSecret({ DOCUMENT_URL_SECRET: ` ${DOCUMENT_URL_SECRET} ` })).toBe(
      DOCUMENT_URL_SECRET,
    );
  });
});
