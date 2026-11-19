import { ApiErrorCode, DriverApplyBodySchema, DriverProfileSchema } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  makeApplyAsDriver,
  makeGetMyDriverProfile,
} from '../../../src/modules/drivers/application/apply';
import type { Actor } from '../../../src/modules/auth/domain/actor';
import { AppError } from '../../../src/shared/errors/app-error';
import { MemoryDriverRepository, sampleVehicle, userId } from '../../support/driver-fakes';

const actor = (n: number): Actor => ({
  userId: userId(n),
  roles: ['PASSENGER'],
  activeMode: 'passenger',
});

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
  const repo = new MemoryDriverRepository();
  return {
    repo,
    apply: makeApplyAsDriver({ repo }),
    getMine: makeGetMyDriverProfile({ repo }),
  };
}

const body = (over: Record<string, unknown> = {}) =>
  DriverApplyBodySchema.parse({ ...sampleVehicle(), plate: 'abc-12d', ...over });

describe('POST /drivers/apply (caso de uso)', () => {
  it('crea el perfil PENDING/OFFLINE con la placa normalizada y sin documentos', async () => {
    const { apply } = setup();
    const profile = DriverProfileSchema.parse(await apply(actor(1), body()));
    expect(profile).toMatchObject({
      userId: userId(1),
      verificationStatus: 'PENDING',
      availability: 'OFFLINE',
      vehicle: { plate: 'ABC12D', vehicleType: 'MOTOTAXI' },
      documents: [],
      rejectionReason: null,
    });
    expect(profile.missingDocuments).toHaveLength(5);
  });

  it('segunda solicitud → 409 DRIVER_ALREADY_APPLIED (PENDING, APPROVED o SUSPENDED)', async () => {
    for (const status of ['PENDING', 'APPROVED', 'SUSPENDED'] as const) {
      const { apply, repo } = setup();
      repo.seed(userId(1), status);
      const err = await errorOf(apply(actor(1), body({ plate: 'XYZ98A' })));
      expect([err.code, err.status]).toEqual([ApiErrorCode.DRIVER_ALREADY_APPLIED, 409]);
    }
  });

  it('carrera al crear (el perfil apareció entre la lectura y el INSERT) → 409', async () => {
    const { apply, repo } = setup();
    repo.findProfile = async () => null;
    repo.seed(userId(1));
    const err = await errorOf(apply(actor(1), body({ plate: 'XYZ98A' })));
    expect(err.code).toBe(ApiErrorCode.DRIVER_ALREADY_APPLIED);
  });

  it('placa de otra cuenta → 409 PLATE_ALREADY_REGISTERED', async () => {
    const { apply, repo } = setup();
    repo.seed(userId(2), 'APPROVED', sampleVehicle({ plate: 'ABC12D' }));
    const err = await errorOf(apply(actor(1), body()));
    expect([err.code, err.status]).toEqual([ApiErrorCode.PLATE_ALREADY_REGISTERED, 409]);
  });

  it('REJECTED: reenvía con el vehículo nuevo y vuelve a PENDING sin motivo', async () => {
    const { apply, repo } = setup();
    const seeded = repo.seed(userId(1), 'REJECTED');
    seeded.rejectionReason = 'La placa no coincide con la tarjeta de propiedad';
    repo.documents.set(`${userId(1)}:CEDULA`, {
      userId: userId(1),
      type: 'CEDULA',
      r2Key: 'k',
      contentType: 'image/jpeg',
      sizeBytes: 10,
      status: 'APPROVED',
      rejectionReason: null,
      uploadedAt: '2026-11-18T12:00:00.000Z',
      reviewedAt: '2026-11-18T12:00:00.000Z',
      reviewedBy: userId(9),
    });
    const profile = await apply(actor(1), body({ plate: 'xyz 98a', color: 'Negro' }));
    expect(profile).toMatchObject({
      verificationStatus: 'PENDING',
      rejectionReason: null,
      vehicle: { plate: 'XYZ98A', color: 'Negro' },
    });
    expect(profile.documents.map((d) => d.type)).toEqual(['CEDULA']);
  });

  it('REJECTED con placa de otro → PLATE_ALREADY_REGISTERED; carrera al reenviar → ALREADY_APPLIED', async () => {
    const { apply, repo } = setup();
    repo.seed(userId(2), 'APPROVED', sampleVehicle({ plate: 'XYZ98A' }));
    repo.seed(userId(1), 'REJECTED', sampleVehicle({ plate: 'ABC12D' }));
    expect((await errorOf(apply(actor(1), body({ plate: 'XYZ98A' })))).code).toBe(
      ApiErrorCode.PLATE_ALREADY_REGISTERED,
    );
    repo.resubmit = async () => ({ ok: false, reason: 'not_rejected' });
    expect((await errorOf(apply(actor(1), body()))).code).toBe(ApiErrorCode.DRIVER_ALREADY_APPLIED);
  });
});

describe('GET /drivers/me (caso de uso)', () => {
  it('sin perfil → 404 DRIVER_NOT_APPLIED', async () => {
    const { getMine } = setup();
    const err = await errorOf(getMine(actor(1)));
    expect([err.code, err.status]).toEqual([ApiErrorCode.DRIVER_NOT_APPLIED, 404]);
  });

  it('devuelve el perfil con documentos y faltantes', async () => {
    const { apply, getMine } = setup();
    await apply(actor(1), body());
    const mine = DriverProfileSchema.parse(await getMine(actor(1)));
    expect(mine.verificationStatus).toBe('PENDING');
    expect(mine.missingDocuments).toEqual([
      'CEDULA',
      'LICENCIA',
      'TARJETA_PROPIEDAD',
      'SOAT',
      'TECNOMECANICA',
    ]);
  });
});
