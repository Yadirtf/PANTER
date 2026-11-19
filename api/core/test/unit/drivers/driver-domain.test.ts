import { DriverVerificationStatus, REQUIRED_DOCUMENTS } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  allDocumentsApproved,
  documentsNotApproved,
  missingDocuments,
  sortDocuments,
  toDriverProfile,
  type DriverDocumentRecord,
} from '../../../src/modules/drivers/domain/driver-profile';
import {
  canEditDocuments,
  canUseDriverMode,
  DriverAction,
  nextStatus,
  requiredStatusFor,
} from '../../../src/modules/drivers/domain/driver-status';
import { isUniqueViolation } from '../../../src/modules/drivers/infrastructure/pg-errors';
import { sampleVehicle, userId } from '../../support/driver-fakes';

const { PENDING, APPROVED, REJECTED, SUSPENDED } = DriverVerificationStatus;

describe('máquina de estados del conductor (tabla completa)', () => {
  // Cada fila: estado de origen × acción → estado siguiente (null = 409 INVALID_DRIVER_TRANSITION).
  const table: [DriverVerificationStatus, DriverAction, DriverVerificationStatus | null][] = [
    [PENDING, 'approve', APPROVED],
    [PENDING, 'reject', REJECTED],
    [PENDING, 'suspend', null],
    [PENDING, 'reinstate', null],
    [PENDING, 'resubmit', null],
    [APPROVED, 'approve', null],
    [APPROVED, 'reject', null],
    [APPROVED, 'suspend', SUSPENDED],
    [APPROVED, 'reinstate', null],
    [APPROVED, 'resubmit', null],
    [REJECTED, 'approve', null],
    [REJECTED, 'reject', null],
    [REJECTED, 'suspend', null],
    [REJECTED, 'reinstate', null],
    [REJECTED, 'resubmit', PENDING],
    [SUSPENDED, 'approve', null],
    [SUSPENDED, 'reject', null],
    [SUSPENDED, 'suspend', null],
    [SUSPENDED, 'reinstate', APPROVED],
    [SUSPENDED, 'resubmit', null],
  ];

  it('cubre los 4 estados × 5 acciones', () => {
    expect(table).toHaveLength(
      Object.values(DriverVerificationStatus).length * Object.values(DriverAction).length,
    );
  });

  it.each(table)('%s + %s → %s', (from, action, to) => {
    expect(nextStatus(from, action)).toBe(to);
    if (to) expect(requiredStatusFor(action)).toBe(from);
  });

  it.each([
    [PENDING, true, false],
    [REJECTED, true, false],
    [APPROVED, false, true],
    [SUSPENDED, false, false],
  ] as const)('%s: edita documentos=%s, modo conductor=%s', (status, edit, drive) => {
    expect(canEditDocuments(status)).toBe(edit);
    expect(canUseDriverMode(status)).toBe(drive);
  });

  it('sin perfil no hay modo conductor', () => {
    expect(canUseDriverMode(null)).toBe(false);
  });
});

function doc(type: DriverDocumentRecord['type'], status: DriverDocumentRecord['status']) {
  return {
    userId: userId(1),
    type,
    r2Key: `drivers/${userId(1)}/${type}/k`,
    contentType: 'image/jpeg' as const,
    sizeBytes: 1000,
    status,
    rejectionReason: status === 'REJECTED' ? 'Foto borrosa, tómala de nuevo' : null,
    uploadedAt: '2026-11-18T12:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
  };
}

describe('documentos del perfil', () => {
  it('faltan los no subidos y los rechazados, en el orden de REQUIRED_DOCUMENTS', () => {
    const docs = [doc('SOAT', 'SUBMITTED'), doc('CEDULA', 'REJECTED')];
    expect(missingDocuments(docs)).toEqual([
      'CEDULA',
      'LICENCIA',
      'TARJETA_PROPIEDAD',
      'TECNOMECANICA',
    ]);
    expect(missingDocuments([])).toEqual(REQUIRED_DOCUMENTS);
  });

  it('aprobar exige los cinco APPROVED', () => {
    const four = REQUIRED_DOCUMENTS.slice(0, 4).map((t) => doc(t, 'APPROVED'));
    expect(allDocumentsApproved(four)).toBe(false);
    expect(documentsNotApproved(four)).toEqual(['TECNOMECANICA']);
    const five = [...four, doc('TECNOMECANICA', 'SUBMITTED')];
    expect(allDocumentsApproved(five)).toBe(false);
    five[4] = doc('TECNOMECANICA', 'APPROVED');
    expect(allDocumentsApproved(five)).toBe(true);
    expect(documentsNotApproved(five)).toEqual([]);
  });

  it('toDriverProfile ordena los documentos y no expone la clave R2', () => {
    const profile = toDriverProfile(
      {
        userId: userId(1),
        vehicle: sampleVehicle(),
        verificationStatus: 'PENDING',
        availability: 'OFFLINE',
        rejectionReason: null,
        appliedAt: '2026-11-18T12:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
      },
      [doc('TECNOMECANICA', 'SUBMITTED'), doc('CEDULA', 'APPROVED')],
    );
    expect(profile.documents.map((d) => d.type)).toEqual(['CEDULA', 'TECNOMECANICA']);
    expect(profile.documents[0]).not.toHaveProperty('r2Key');
    expect(profile.missingDocuments).toEqual(['LICENCIA', 'TARJETA_PROPIEDAD', 'SOAT']);
    expect(
      sortDocuments([doc('SOAT', 'SUBMITTED'), doc('LICENCIA', 'SUBMITTED')]).map((d) => d.type),
    ).toEqual(['LICENCIA', 'SOAT']);
  });
});

describe('isUniqueViolation', () => {
  it('reconoce postgres-js, neon y el error envuelto por Drizzle', () => {
    const pg = { code: '23505', constraint_name: 'driver_profiles_plate_key' };
    const neon = { code: '23505', constraint: 'driver_profiles_plate_key' };
    expect(isUniqueViolation(pg, 'driver_profiles_plate_key')).toBe(true);
    expect(isUniqueViolation(neon, 'driver_profiles_plate_key')).toBe(true);
    expect(isUniqueViolation(new Error('x', { cause: pg }), 'driver_profiles_plate_key')).toBe(
      true,
    );
  });

  it('otra restricción, otro código o algo que no es error → false', () => {
    expect(
      isUniqueViolation({ code: '23505', constraint: 'otra' }, 'driver_profiles_plate_key'),
    ).toBe(false);
    expect(
      isUniqueViolation(
        { code: '23503', constraint: 'driver_profiles_plate_key' },
        'driver_profiles_plate_key',
      ),
    ).toBe(false);
    expect(isUniqueViolation(null, 'x')).toBe(false);
    expect(isUniqueViolation('boom', 'x')).toBe(false);
  });
});
