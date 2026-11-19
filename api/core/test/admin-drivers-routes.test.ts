// HU-204: rutas /admin/drivers dentro de workerd, con R2 y la cola EVENTS de Miniflare.
import {
  adminDocumentPath,
  adminDriverPath,
  AdminDriverRoutes,
  AdminDriverSchema,
  AdminDriversResponseSchema,
  DocumentViewUrlResponseSchema,
  REQUIRED_DOCUMENTS,
  Role,
  type DriverApprovedEvent,
} from '@panter/contracts';
import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildAuthFactories } from '../src/composition/auth';
import { buildAdminDriverFactories } from '../src/composition/drivers';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { createJoseAccessTokenSigner } from '../src/modules/auth/infrastructure/jose-access-tokens';
import { createQueueEventPublisher } from '../src/modules/drivers/infrastructure/queue-event-publisher';
import { MemoryUserRepository } from './support/auth-fakes';
import {
  IMAGES,
  MemoryDriverRepository,
  MemoryDriverReviewRepository,
  seedDocument,
  userId,
} from './support/driver-fakes';
import { testKeys, type TestKeys } from './support/jwt-keys';

const DOCUMENT_URL_SECRET = 'test-document-url-secret-0123456789abcdef0123456789';
const ADMIN = userId(100);
const DRIVER = userId(1);

let keys: TestKeys;
beforeAll(async () => {
  keys = await testKeys();
});

const testEnv = (): Env => ({ ...env, JWT_PUBLIC_KEY: keys.publicKeyPem, DOCUMENT_URL_SECRET });

interface ErrorJson {
  error: { code: string; message: string; details?: unknown };
}

function setup(options: { failQueue?: boolean } = {}) {
  const drivers = new MemoryDriverRepository();
  const repo = new MemoryDriverReviewRepository(drivers);
  repo.account(ADMIN, 'admin@panter.test', { admin: true });
  repo.account(DRIVER, 'luis@villagarzon.test');
  const sent: DriverApprovedEvent[] = [];
  const app = createApp({
    auth: buildAuthFactories({ users: () => new MemoryUserRepository() }),
    adminDrivers: buildAdminDriverFactories({
      repo: () => repo,
      events: (e) =>
        options.failQueue
          ? {
              publish: async () => {
                throw new Error('Queue send failed');
              },
            }
          : {
              publish: async (event) => {
                sent.push(event);
                await createQueueEventPublisher(e.EVENTS).publish(event);
              },
            },
    }),
  });
  async function call(
    method: string,
    path: string,
    body?: unknown,
    roles: Role[] = [Role.PASSENGER, Role.ADMIN],
  ) {
    const signer = createJoseAccessTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: 'k' });
    const { token } = await signer.sign({ userId: ADMIN, roles, activeMode: 'passenger' });
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    return app.request(
      `https://api.test${path}`,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      testEnv(),
    );
  }
  return { app, drivers, repo, sent, call };
}

async function codeOf(res: Response) {
  return [res.status, (await res.json<ErrorJson>()).error.code];
}

describe('acceso', () => {
  it.each([
    ['GET', AdminDriverRoutes.LIST],
    ['GET', adminDriverPath(DRIVER)],
    ['GET', adminDocumentPath(DRIVER, 'SOAT', 'view-url')],
    ['POST', adminDocumentPath(DRIVER, 'SOAT', 'review')],
    ['POST', adminDriverPath(DRIVER, 'approve')],
    ['POST', adminDriverPath(DRIVER, 'reject')],
    ['POST', adminDriverPath(DRIVER, 'suspend')],
    ['POST', adminDriverPath(DRIVER, 'reinstate')],
  ])('%s %s: DISPATCHER → 403 FORBIDDEN; sin token → 401', async (method, path) => {
    const { call } = setup();
    expect(await codeOf(await call(method, path, undefined, [Role.DISPATCHER]))).toEqual([
      403,
      'FORBIDDEN',
    ]);
    expect((await exports.default.fetch(`https://api.test${path}`, { method })).status).toBe(401);
  });
});

describe('GET /admin/drivers y detalle', () => {
  it('lista pendientes con cursor y muestra el detalle', async () => {
    const { drivers, call } = setup();
    for (let i = 1; i <= 3; i++) drivers.seed(userId(i));
    const res = await call('GET', `${AdminDriverRoutes.LIST}?status=PENDING&limit=2`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const page = AdminDriversResponseSchema.parse(await res.json());
    expect(page.items.map((d) => d.userId)).toEqual([userId(1), userId(2)]);
    const next = AdminDriversResponseSchema.parse(
      await (
        await call('GET', `${AdminDriverRoutes.LIST}?limit=2&cursor=${page.nextCursor}`)
      ).json(),
    );
    expect(next.items.map((d) => d.userId)).toEqual([userId(3)]);
    const detail = AdminDriverSchema.parse(
      await (await call('GET', adminDriverPath(DRIVER))).json(),
    );
    expect(detail.email).toBe('luis@villagarzon.test');
    expect(await codeOf(await call('GET', adminDriverPath(userId(50))))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    expect((await call('GET', `${AdminDriverRoutes.LIST}?status=OTRO`)).status).toBe(400);
  });
});

describe('ver documento con URL firmada', () => {
  it('GET firmado sin Bearer: imagen de R2, private no-store e inline', async () => {
    const { app, drivers, call } = setup();
    drivers.seed(DRIVER);
    const doc = seedDocument(drivers, DRIVER, 'CEDULA');
    await env.DOCUMENTS.put(doc.r2Key, IMAGES['image/jpeg'](), {
      httpMetadata: { contentType: 'image/jpeg' },
    });
    const res = await call('GET', adminDocumentPath(DRIVER, 'CEDULA', 'view-url'));
    expect(res.status).toBe(200);
    const view = DocumentViewUrlResponseSchema.parse(await res.json());

    const file = await app.request(view.url, {}, testEnv());
    expect(file.status).toBe(200);
    expect(file.headers.get('Content-Type')).toBe('image/jpeg');
    expect(file.headers.get('Cache-Control')).toBe('private, no-store');
    expect(file.headers.get('Content-Disposition')).toBe('inline; filename="cedula.jpg"');
    expect(file.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(file.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(IMAGES['image/jpeg']());

    const tampered = await app.request(`${view.url}x`, {}, testEnv());
    expect(await codeOf(tampered)).toEqual([403, 'UPLOAD_URL_INVALID']);
  });
});

describe('decisiones', () => {
  it('revisa los 5 documentos, aprueba (cola EVENTS) y otorga DRIVER', async () => {
    const { drivers, repo, sent, call } = setup();
    drivers.seed(DRIVER);
    for (const type of REQUIRED_DOCUMENTS) seedDocument(drivers, DRIVER, type);
    expect(await codeOf(await call('POST', adminDriverPath(DRIVER, 'approve'), {}))).toEqual([
      409,
      'DOCUMENTS_INCOMPLETE',
    ]);
    for (const type of REQUIRED_DOCUMENTS) {
      const res = await call('POST', adminDocumentPath(DRIVER, type, 'review'), {
        decision: 'APPROVED',
      });
      expect(res.status).toBe(200);
    }
    const res = await call('POST', adminDriverPath(DRIVER, 'approve'), {});
    expect(res.status).toBe(200);
    expect(AdminDriverSchema.parse(await res.json()).verificationStatus).toBe('APPROVED');
    expect(repo.accounts.get(DRIVER)?.roles).toContain('DRIVER');
    expect(sent.map((e) => e.type)).toEqual(['DriverApproved']);
    expect(await codeOf(await call('POST', adminDriverPath(DRIVER, 'approve')))).toEqual([
      409,
      'INVALID_DRIVER_TRANSITION',
    ]);
  });

  it('la cola falla: aprueba igual y lo registra en el log', async () => {
    const { drivers, call } = setup({ failQueue: true });
    drivers.seed(DRIVER);
    for (const type of REQUIRED_DOCUMENTS) seedDocument(drivers, DRIVER, type, 'APPROVED');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call('POST', adminDriverPath(DRIVER, 'approve'));
    expect(res.status).toBe(200);
    expect(JSON.stringify(log.mock.calls)).toContain('driver_approved_publish_failed');
    log.mockRestore();
  });

  it('rechazo de documento sin motivo → 400; reject y suspend exigen motivo', async () => {
    const { drivers, call } = setup();
    drivers.seed(DRIVER);
    seedDocument(drivers, DRIVER, 'SOAT');
    expect(
      (await call('POST', adminDocumentPath(DRIVER, 'SOAT', 'review'), { decision: 'REJECTED' }))
        .status,
    ).toBe(400);
    expect((await call('POST', adminDriverPath(DRIVER, 'reject'), { reason: 'no' })).status).toBe(
      400,
    );
    const rejected = await call('POST', adminDriverPath(DRIVER, 'reject'), {
      reason: 'La tarjeta de propiedad no es del vehículo',
    });
    expect(AdminDriverSchema.parse(await rejected.json()).verificationStatus).toBe('REJECTED');
  });

  it('suspend → SUSPENDED/OFFLINE; reinstate → APPROVED; transición inválida → 409', async () => {
    const { drivers, call } = setup();
    drivers.seed(DRIVER, 'APPROVED').availability = 'AVAILABLE';
    expect(await codeOf(await call('POST', adminDriverPath(DRIVER, 'reinstate')))).toEqual([
      409,
      'INVALID_DRIVER_TRANSITION',
    ]);
    const suspended = AdminDriverSchema.parse(
      await (
        await call('POST', adminDriverPath(DRIVER, 'suspend'), {
          reason: 'Varias quejas por cobro de más',
        })
      ).json(),
    );
    expect([suspended.verificationStatus, suspended.availability]).toEqual([
      'SUSPENDED',
      'OFFLINE',
    ]);
    const back = AdminDriverSchema.parse(
      await (await call('POST', adminDriverPath(DRIVER, 'reinstate'))).json(),
    );
    expect(back.verificationStatus).toBe('APPROVED');
  });
});

describe('createQueueEventPublisher', () => {
  it('valida el evento con el contrato antes de enviarlo', async () => {
    const send = vi.fn(async () => {});
    const publisher = createQueueEventPublisher({ send } as unknown as Queue);
    await expect(
      publisher.publish({ type: 'DriverApproved' } as unknown as DriverApprovedEvent),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
