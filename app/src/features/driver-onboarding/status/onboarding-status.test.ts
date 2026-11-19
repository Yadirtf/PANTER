import { REQUIRED_DOCUMENTS } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { documentRows } from '../documents/document-states';
import { makeDocument, makeProfile } from '../test-helpers';
import { listLabels, onboardingView, statusTransition } from './onboarding-status';

const allSubmitted = REQUIRED_DOCUMENTS.map((type) => makeDocument(type));

function viewOf(profile: Parameters<typeof onboardingView>[0]) {
  return onboardingView(profile, documentRows(profile, []));
}

describe('onboardingView', () => {
  it('sin solicitud: paso del vehículo', () => {
    expect(viewOf(null)).toEqual({ kind: 'notApplied' });
  });

  it('PENDING con documentos por entregar: dice cuáles faltan', () => {
    const profile = makeProfile({
      documents: [makeDocument('CEDULA'), makeDocument('LICENCIA', { status: 'APPROVED' })],
    });
    expect(viewOf(profile)).toEqual({
      kind: 'pending',
      missing: ['TARJETA_PROPIEDAD', 'SOAT', 'TECNOMECANICA'],
      title: 'Completa tus documentos',
      message:
        'Te falta entregar: Tarjeta de propiedad del vehículo, SOAT vigente y Revisión técnico-mecánica vigente. Cuando estén los 5, revisamos tu solicitud.',
    });
  });

  it('PENDING con los 5 entregados: en revisión', () => {
    expect(viewOf(makeProfile({ documents: allSubmitted }))).toMatchObject({
      kind: 'pending',
      missing: [],
      title: 'Solicitud en revisión',
    });
  });

  it('REJECTED: motivo y solo los documentos rechazados (o faltantes) para corregir', () => {
    const profile = makeProfile({
      verificationStatus: 'REJECTED',
      rejectionReason: 'El SOAT está vencido y la licencia no se lee.',
      documents: [
        makeDocument('CEDULA', { status: 'APPROVED' }),
        makeDocument('LICENCIA', { status: 'REJECTED', rejectionReason: 'Borrosa' }),
        makeDocument('TARJETA_PROPIEDAD', { status: 'APPROVED' }),
        makeDocument('SOAT', { status: 'REJECTED', rejectionReason: 'Vencido' }),
        makeDocument('TECNOMECANICA', { status: 'APPROVED' }),
      ],
    });
    expect(viewOf(profile)).toEqual({
      kind: 'rejected',
      reason: 'El SOAT está vencido y la licencia no se lee.',
      toFix: ['LICENCIA', 'SOAT'],
      message:
        'Vuelve a tomar la foto de: Licencia de conducción y SOAT vigente. Si el problema es el vehículo, corrige sus datos.',
    });
  });

  it('REJECTED por el vehículo (documentos bien): pide corregir el vehículo', () => {
    const profile = makeProfile({
      verificationStatus: 'REJECTED',
      rejectionReason: 'La placa no coincide con la tarjeta de propiedad.',
      documents: REQUIRED_DOCUMENTS.map((type) => makeDocument(type, { status: 'APPROVED' })),
    });
    expect(viewOf(profile)).toMatchObject({
      kind: 'rejected',
      toFix: [],
      message: expect.stringContaining('corrige los datos del vehículo'),
    });
  });

  it('REJECTED sin motivo escrito usa un texto por defecto', () => {
    const view = viewOf(makeProfile({ verificationStatus: 'REJECTED', rejectionReason: null }));
    expect(view).toMatchObject({ kind: 'rejected', reason: expect.stringContaining('no indicó') });
  });

  it('APPROVED: "¡Ya eres conductor!"', () => {
    expect(viewOf(makeProfile({ verificationStatus: 'APPROVED' }))).toMatchObject({
      kind: 'approved',
      title: '¡Ya eres conductor!',
    });
  });

  it('SUSPENDED: motivo y que sigue pudiendo usar la app como pasajero', () => {
    const view = viewOf(
      makeProfile({ verificationStatus: 'SUSPENDED', rejectionReason: 'SOAT vencido' }),
    );
    expect(view).toEqual({
      kind: 'suspended',
      reason: 'SOAT vencido',
      message:
        'Tu modo conductor está suspendido. Puedes seguir usando PANTER como pasajero con normalidad.',
    });
  });

  it('une etiquetas en español', () => {
    expect(listLabels([])).toBe('');
    expect(listLabels(['SOAT'])).toBe('SOAT vigente');
    expect(listLabels(['CEDULA', 'SOAT'])).toBe('Cédula de ciudadanía y SOAT vigente');
  });
});

describe('statusTransition', () => {
  it('no avisa en la primera carga ni si no cambia', () => {
    expect(statusTransition(undefined, 'APPROVED')).toBeNull();
    expect(statusTransition('PENDING', 'PENDING')).toBeNull();
    expect(statusTransition('PENDING', null)).toBeNull();
  });

  it.each([
    [null, 'PENDING', 'info', 'Recibimos tu solicitud. Ahora sube tus documentos.'],
    ['PENDING', 'APPROVED', 'success', '¡Tu solicitud fue aprobada!'],
    [
      'PENDING',
      'REJECTED',
      'warning',
      'Tu solicitud fue rechazada. Revisa el motivo y lo que debes corregir.',
    ],
    [
      'REJECTED',
      'PENDING',
      'info',
      'Recibimos tu corrección. Tu solicitud está otra vez en revisión.',
    ],
    ['REJECTED', 'APPROVED', 'success', '¡Tu solicitud fue aprobada!'],
    ['APPROVED', 'SUSPENDED', 'warning', 'Tu modo conductor fue suspendido.'],
    ['SUSPENDED', 'APPROVED', 'success', 'Se levantó la suspensión: ya puedes volver a conducir.'],
  ] as const)('%s → %s', (previous, next, tone, message) => {
    expect(statusTransition(previous, next)).toEqual({ tone, message });
  });
});
