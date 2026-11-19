import {
  AdminDriverSchema,
  ApiErrorCode,
  DriverApprovedEventSchema,
  REQUIRED_DOCUMENTS,
  type DriverApprovedEvent,
} from '@panter/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  DOCUMENT_VIEW_TTL_SECONDS,
  makeApproveDriver,
  makeCreateViewUrl,
  makeGetDriver,
  makeListDrivers,
  makeReadDocument,
  makeReinstateDriver,
  makeRejectDriver,
  makeReviewDocument,
  makeSuspendDriver,
} from '../../../src/modules/drivers/application/admin-review';
import type { Actor } from '../../../src/modules/auth/domain/actor';
import {
  decodeGrant,
  encodeGrant,
  splitToken,
} from '../../../src/modules/drivers/domain/document-url';
import {
  decodeDriverCursor,
  encodeDriverCursor,
} from '../../../src/modules/drivers/domain/driver-cursor';
import { createHmacDocumentUrlSigner } from '../../../src/modules/drivers/infrastructure/hmac-document-url-signer';
import { AppError } from '../../../src/shared/errors/app-error';
import { manualClock } from '../../support/auth-fakes';
import {
  IMAGES,
  MemoryDocumentStorage,
  MemoryDriverRepository,
  MemoryDriverReviewRepository,
  seedDocument,
  userId,
} from '../../support/driver-fakes';

const SECRET = 'test-document-url-secret-0123456789abcdef0123456789';
const ORIGIN = 'https://panter-api-staging.panter.workers.dev';
const ADMIN = userId(100);
const DRIVER = userId(1);
const admin: Actor = { userId: ADMIN, roles: ['PASSENGER', 'ADMIN'], activeMode: 'passenger' };

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  const err = await promise.then(
    () => {
      throw new Error('se esperaba un error');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

function setup() {
  const clock = manualClock();
  const drivers = new MemoryDriverRepository();
  const repo = new MemoryDriverReviewRepository(drivers);
  repo.account(ADMIN, 'admin@panter.test', { admin: true });
  repo.account(DRIVER, 'conductor@villagarzon.test', { fullName: 'Luis Muñoz' });
  const published: DriverApprovedEvent[] = [];
  const events = { publish: vi.fn(async (e: DriverApprovedEvent) => void published.push(e)) };
  const onPublishFailure = vi.fn();
  const signer = createHmacDocumentUrlSigner(SECRET);
  const storage = new MemoryDocumentStorage();
  return {
    clock,
    drivers,
    repo,
    published,
    events,
    onPublishFailure,
    signer,
    storage,
    list: makeListDrivers({ repo }),
    detail: makeGetDriver({ repo }),
    viewUrl: makeCreateViewUrl({ repo, signer, clock: clock.now }),
    read: makeReadDocument({ signer, storage, clock: clock.now }),
    review: makeReviewDocument({ repo }),
    approve: makeApproveDriver({
      repo,
      events,
      clock: clock.now,
      newId: () => '6f9619ff-8b86-4d11-b42d-00c04fc964ff',
      onPublishFailure,
    }),
    reject: makeRejectDriver({ repo }),
    suspend: makeSuspendDriver({ repo }),
    reinstate: makeReinstateDriver({ repo }),
  };
}

function allApproved(drivers: MemoryDriverRepository, id = DRIVER) {
  for (const type of REQUIRED_DOCUMENTS) seedDocument(drivers, id, type, 'APPROVED');
}

describe('listado y detalle', () => {
  it('filtra por estado y pagina por cursor del más antiguo al más reciente', async () => {
    const { drivers, repo, list } = setup();
    for (let i = 1; i <= 3; i++) {
      drivers.seed(userId(i));
      repo.account(userId(i), `c${i}@villagarzon.test`);
    }
    drivers.seed(userId(4), 'APPROVED');
    const first = await list({ status: 'PENDING', limit: 2 });
    expect(first.items.map((d) => d.email)).toEqual(['c1@villagarzon.test', 'c2@villagarzon.test']);
    expect(AdminDriverSchema.parse(first.items[0])).toBeDefined();
    const second = await list({ status: 'PENDING', limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((d) => d.userId)).toEqual([userId(3)]);
    expect(second.nextCursor).toBeNull();
    expect((await list({ limit: 20 })).items).toHaveLength(4);
  });

  it('cursor inválido → 400', async () => {
    const { list } = setup();
    expect((await errorOf(list({ limit: 2, cursor: 'xx' }))).code).toBe('VALIDATION_ERROR');
  });

  it('detalle con el correo de quien revisó; inexistente → 404', async () => {
    const { drivers, detail, reject } = setup();
    drivers.seed(DRIVER);
    await reject(admin, { userId: DRIVER, reason: 'La placa no coincide con la tarjeta' });
    const view = AdminDriverSchema.parse(await detail(DRIVER));
    expect(view).toMatchObject({
      email: 'conductor@villagarzon.test',
      fullName: 'Luis Muñoz',
      reviewedBy: 'admin@panter.test',
      verificationStatus: 'REJECTED',
      rejectionReason: 'La placa no coincide con la tarjeta',
    });
    expect((await errorOf(detail(userId(9)))).status).toBe(404);
  });

  it('cursor: ida y vuelta, y rechaza lo alterado', () => {
    const c = { appliedAt: '2026-11-18T12:00:00.123456Z', userId: DRIVER };
    expect(decodeDriverCursor(encodeDriverCursor(c))).toEqual(c);
    expect(decodeDriverCursor(btoa('{"a":"ayer","u":"x"}'))).toBeNull();
    expect(decodeDriverCursor(btoa('{"a":1}'))).toBeNull();
    expect(decodeDriverCursor('%%%')).toBeNull();
  });
});

describe('URL firmada de lectura', () => {
  it('firma una URL de 5 minutos que lee de R2; vencida o de subida → 403', async () => {
    const { drivers, storage, viewUrl, read, clock, signer } = setup();
    drivers.seed(DRIVER);
    const doc = seedDocument(drivers, DRIVER, 'SOAT');
    await storage.put(doc.r2Key, IMAGES['image/jpeg'](), {
      contentType: 'image/jpeg',
      userId: DRIVER,
      type: 'SOAT',
    });
    const res = await viewUrl({ userId: DRIVER, type: 'SOAT', origin: ORIGIN });
    expect(res.url.startsWith(`${ORIGIN}/drivers/documents/view?token=`)).toBe(true);
    expect(Date.parse(res.expiresAt) - clock.now()).toBeLessThanOrEqual(
      DOCUMENT_VIEW_TTL_SECONDS * 1000,
    );
    const token = new URL(res.url).searchParams.get('token')!;
    const file = await read(token);
    expect([file.contentType, file.size, file.type]).toEqual(['image/jpeg', 12, 'SOAT']);
    expect(new Uint8Array(await new Response(file.body).arrayBuffer())).toEqual(
      IMAGES['image/jpeg'](),
    );

    // Una URL de subida firmada con la misma llave no sirve para leer.
    const grant = decodeGrant(splitToken(token)!.payload)!;
    const upload = encodeGrant({ ...grant, purpose: 'upload', maxBytes: 10 });
    expect((await errorOf(read(`${upload}.${await signer.sign(upload)}`))).code).toBe(
      ApiErrorCode.UPLOAD_URL_INVALID,
    );
    expect((await errorOf(read(undefined))).status).toBe(403);
    clock.advance(DOCUMENT_VIEW_TTL_SECONDS * 1000);
    expect((await errorOf(read(token))).status).toBe(403);
  });

  it('documento sin subir → 404; objeto borrado de R2 → 404', async () => {
    const { drivers, viewUrl, read } = setup();
    drivers.seed(DRIVER);
    expect(
      (await errorOf(viewUrl({ userId: DRIVER, type: 'CEDULA', origin: ORIGIN }))).message,
    ).toBe('El solicitante aún no ha subido: Cédula de ciudadanía.');
    seedDocument(drivers, DRIVER, 'CEDULA');
    const res = await viewUrl({ userId: DRIVER, type: 'CEDULA', origin: ORIGIN });
    expect((await errorOf(read(new URL(res.url).searchParams.get('token')!))).status).toBe(404);
  });

  it('usa Date.now por defecto', async () => {
    const drivers = new MemoryDriverRepository();
    const repo = new MemoryDriverReviewRepository(drivers);
    drivers.seed(DRIVER);
    seedDocument(drivers, DRIVER, 'SOAT');
    const signer = createHmacDocumentUrlSigner(SECRET);
    const res = await makeCreateViewUrl({ repo, signer })({
      userId: DRIVER,
      type: 'SOAT',
      origin: ORIGIN,
    });
    expect(Date.parse(res.expiresAt)).toBeGreaterThan(Date.now());
    const storage = new MemoryDocumentStorage();
    await expect(
      makeReadDocument({ signer, storage })(new URL(res.url).searchParams.get('token')!),
    ).rejects.toThrow(AppError);
  });
});

describe('revisión de documentos', () => {
  it('aprueba y rechaza con motivo; guarda quién y cuándo', async () => {
    const { drivers, review } = setup();
    drivers.seed(DRIVER);
    seedDocument(drivers, DRIVER, 'LICENCIA');
    seedDocument(drivers, DRIVER, 'SOAT');
    await review(admin, { userId: DRIVER, type: 'LICENCIA', body: { decision: 'APPROVED' } });
    const after = await review(admin, {
      userId: DRIVER,
      type: 'SOAT',
      body: { decision: 'REJECTED', reason: 'El SOAT está vencido desde octubre' },
    });
    expect(after.documents.find((d) => d.type === 'LICENCIA')).toMatchObject({
      status: 'APPROVED',
      rejectionReason: null,
    });
    expect(after.documents.find((d) => d.type === 'SOAT')).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'El SOAT está vencido desde octubre',
    });
    expect(after.missingDocuments).toContain('SOAT');
    expect(drivers.documents.get(`${DRIVER}:SOAT`)?.reviewedBy).toBe(ADMIN);
  });

  it('documento sin subir → 404; solicitud APPROVED o SUSPENDED → 409; sin solicitud → 404', async () => {
    const { drivers, review } = setup();
    const body = { decision: 'APPROVED' } as const;
    expect((await errorOf(review(admin, { userId: DRIVER, type: 'SOAT', body }))).status).toBe(404);
    drivers.seed(DRIVER);
    expect((await errorOf(review(admin, { userId: DRIVER, type: 'SOAT', body }))).status).toBe(404);
    seedDocument(drivers, DRIVER, 'SOAT');
    for (const status of ['APPROVED', 'SUSPENDED'] as const) {
      drivers.profiles.get(DRIVER)!.verificationStatus = status;
      const err = await errorOf(review(admin, { userId: DRIVER, type: 'SOAT', body }));
      expect([err.code, err.status]).toEqual([ApiErrorCode.INVALID_DRIVER_TRANSITION, 409]);
    }
    // REJECTED sí: el ADMIN revisa lo que el solicitante corrigió.
    drivers.profiles.get(DRIVER)!.verificationStatus = 'REJECTED';
    await expect(review(admin, { userId: DRIVER, type: 'SOAT', body })).resolves.toBeDefined();
  });

  it('actor que ya no es ADMIN en la base de datos → 403; carrera de estado → 409', async () => {
    const { drivers, repo, review } = setup();
    drivers.seed(DRIVER);
    seedDocument(drivers, DRIVER, 'SOAT');
    const body = { decision: 'APPROVED' } as const;
    repo.accounts.get(ADMIN)!.admin = false;
    expect((await errorOf(review(admin, { userId: DRIVER, type: 'SOAT', body }))).code).toBe(
      ApiErrorCode.FORBIDDEN,
    );
    repo.accounts.get(ADMIN)!.admin = true;
    repo.reviewDocument = async () => ({ actorIsAdmin: true, changed: false });
    expect((await errorOf(review(admin, { userId: DRIVER, type: 'SOAT', body }))).code).toBe(
      ApiErrorCode.INVALID_DRIVER_TRANSITION,
    );
  });
});

describe('aprobar', () => {
  it('con los 5 documentos APPROVED: APPROVED, rol DRIVER auditado y evento DriverApproved', async () => {
    const { drivers, repo, approve, published, clock } = setup();
    drivers.seed(DRIVER);
    allApproved(drivers);
    const driver = await approve(admin, { userId: DRIVER });
    expect(driver).toMatchObject({
      verificationStatus: 'APPROVED',
      reviewedBy: 'admin@panter.test',
    });
    expect(repo.accounts.get(DRIVER)?.roles).toContain('DRIVER');
    expect(repo.audit).toEqual([{ actorId: ADMIN, userId: DRIVER, role: 'DRIVER' }]);
    expect(published).toHaveLength(1);
    expect(DriverApprovedEventSchema.parse(published[0])).toEqual({
      type: 'DriverApproved',
      version: 1,
      eventId: '6f9619ff-8b86-4d11-b42d-00c04fc964ff',
      occurredAt: new Date(clock.now()).toISOString(),
      payload: { userId: DRIVER, vehicleType: 'MOTOTAXI', plate: 'ABC12D', approvedBy: ADMIN },
    });
  });

  it('falta un documento o no está aprobado → 409 DOCUMENTS_INCOMPLETE con details.pending', async () => {
    const { drivers, approve, published } = setup();
    drivers.seed(DRIVER);
    for (const type of REQUIRED_DOCUMENTS.slice(0, 3))
      seedDocument(drivers, DRIVER, type, 'APPROVED');
    seedDocument(drivers, DRIVER, 'SOAT', 'SUBMITTED');
    const err = await errorOf(approve(admin, { userId: DRIVER }));
    expect([err.code, err.status, err.details]).toEqual([
      ApiErrorCode.DOCUMENTS_INCOMPLETE,
      409,
      { pending: ['SOAT', 'TECNOMECANICA'] },
    ]);
    expect(err.message).toContain('SOAT vigente, Revisión técnico-mecánica vigente');
    expect(published).toHaveLength(0);
  });

  it('REJECTED corregida también se aprueba; APPROVED o SUSPENDED → 409', async () => {
    const { drivers, approve } = setup();
    drivers.seed(DRIVER, 'REJECTED');
    allApproved(drivers);
    expect((await approve(admin, { userId: DRIVER })).verificationStatus).toBe('APPROVED');
    for (const status of ['APPROVED', 'SUSPENDED'] as const) {
      drivers.profiles.get(DRIVER)!.verificationStatus = status;
      const err = await errorOf(approve(admin, { userId: DRIVER }));
      expect([err.code, err.status]).toEqual([ApiErrorCode.INVALID_DRIVER_TRANSITION, 409]);
    }
  });

  it('si la cola falla, la aprobación no se revierte y queda en el log', async () => {
    const { drivers, approve, events, onPublishFailure } = setup();
    drivers.seed(DRIVER);
    allApproved(drivers);
    events.publish.mockRejectedValueOnce(new Error('Queue send failed'));
    const driver = await approve(admin, { userId: DRIVER });
    expect(driver.verificationStatus).toBe('APPROVED');
    expect(onPublishFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Queue send failed' }),
      expect.objectContaining({ type: 'DriverApproved' }),
    );
  });

  it('carreras: otro ADMIN decidió o un documento cambió → 409 con el código correcto', async () => {
    const { drivers, repo, approve } = setup();
    drivers.seed(DRIVER);
    allApproved(drivers);
    const original = repo.approve.bind(repo);
    repo.approve = async (input) => {
      drivers.documents.get(`${DRIVER}:CEDULA`)!.status = 'REJECTED';
      return original(input);
    };
    expect((await errorOf(approve(admin, { userId: DRIVER }))).code).toBe(
      ApiErrorCode.DOCUMENTS_INCOMPLETE,
    );
    drivers.documents.get(`${DRIVER}:CEDULA`)!.status = 'APPROVED';
    repo.approve = async () => {
      drivers.profiles.get(DRIVER)!.verificationStatus = 'APPROVED';
      return { actorIsAdmin: true, changed: false };
    };
    expect((await errorOf(approve(admin, { userId: DRIVER }))).code).toBe(
      ApiErrorCode.INVALID_DRIVER_TRANSITION,
    );
  });

  it('actor que ya no es ADMIN → 403; usa reloj y uuid reales por defecto', async () => {
    const { drivers, repo } = setup();
    drivers.seed(DRIVER);
    allApproved(drivers);
    const events = { publish: vi.fn(async () => {}) };
    const approve = makeApproveDriver({ repo, events });
    repo.accounts.get(ADMIN)!.active = false;
    expect((await errorOf(approve(admin, { userId: DRIVER }))).code).toBe(ApiErrorCode.FORBIDDEN);
    repo.accounts.get(ADMIN)!.active = true;
    await approve(admin, { userId: DRIVER });
    expect(events.publish).toHaveBeenCalledTimes(1);
    // Sin onPublishFailure tampoco revienta.
    drivers.profiles.get(DRIVER)!.verificationStatus = 'PENDING';
    events.publish.mockRejectedValueOnce(new Error('caída'));
    await expect(approve(admin, { userId: DRIVER })).resolves.toBeDefined();
  });
});

describe('rechazar, suspender y reactivar', () => {
  it('reject: PENDING → REJECTED con motivo; otra vez → 409', async () => {
    const { drivers, reject } = setup();
    drivers.seed(DRIVER);
    const driver = await reject(admin, { userId: DRIVER, reason: 'Documentos ilegibles' });
    expect(driver).toMatchObject({
      verificationStatus: 'REJECTED',
      rejectionReason: 'Documentos ilegibles',
    });
    const err = await errorOf(reject(admin, { userId: DRIVER, reason: 'Documentos ilegibles' }));
    expect([err.code, err.message]).toEqual([
      ApiErrorCode.INVALID_DRIVER_TRANSITION,
      'No se puede rechazar una solicitud rechazada.',
    ]);
  });

  it('suspend: solo desde APPROVED, deja OFFLINE y conserva DRIVER; reinstate vuelve a APPROVED', async () => {
    const { drivers, repo, suspend, reinstate } = setup();
    drivers.seed(DRIVER).availability = 'AVAILABLE';
    expect(
      (await errorOf(suspend(admin, { userId: DRIVER, reason: 'Quejas de pasajeros' }))).code,
    ).toBe(ApiErrorCode.INVALID_DRIVER_TRANSITION);
    drivers.profiles.get(DRIVER)!.verificationStatus = 'APPROVED';
    repo.accounts.get(DRIVER)!.roles.push('DRIVER');
    const suspended = await suspend(admin, { userId: DRIVER, reason: 'Quejas de pasajeros' });
    expect(suspended).toMatchObject({
      verificationStatus: 'SUSPENDED',
      availability: 'OFFLINE',
      rejectionReason: 'Quejas de pasajeros',
    });
    expect(repo.accounts.get(DRIVER)?.roles).toContain('DRIVER');
    expect(await drivers.canUseDriverMode(DRIVER)).toBe(false);

    const back = await reinstate(admin, { userId: DRIVER });
    expect(back).toMatchObject({ verificationStatus: 'APPROVED', rejectionReason: null });
    expect(await drivers.canUseDriverMode(DRIVER)).toBe(true);
    expect((await errorOf(reinstate(admin, { userId: DRIVER }))).code).toBe(
      ApiErrorCode.INVALID_DRIVER_TRANSITION,
    );
  });

  it('sin solicitud → 404; actor sin ADMIN → 403; carrera → 409', async () => {
    const { drivers, repo, reject } = setup();
    expect((await errorOf(reject(admin, { userId: DRIVER, reason: 'motivo largo' }))).status).toBe(
      404,
    );
    drivers.seed(DRIVER);
    repo.accounts.get(ADMIN)!.admin = false;
    expect((await errorOf(reject(admin, { userId: DRIVER, reason: 'motivo largo' }))).status).toBe(
      403,
    );
    repo.accounts.get(ADMIN)!.admin = true;
    repo.changeStatus = async () => ({ actorIsAdmin: true, changed: false });
    expect((await errorOf(reject(admin, { userId: DRIVER }))).status).toBe(409);
  });
});
