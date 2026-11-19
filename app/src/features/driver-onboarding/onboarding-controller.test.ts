import type { DriverDocument, DriverProfile } from '@panter/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, networkError } from '../../shared/api/errors';
import { deferred } from '../../test/fake-api';
import type { DriversApi } from './api/drivers-api';
import { mergeDocument, OnboardingController } from './onboarding-controller';
import { makeDocument, makeProfile } from './test-helpers';
import type { VehicleFormValues } from './vehicle/vehicle-form';

const NOW = new Date('2026-11-18T15:00:00Z');

const form: VehicleFormValues = {
  vehicleType: 'MOTOTAXI',
  plate: 'abc 12d',
  brand: 'Bajaj',
  model: 'RE 4S',
  color: 'Verde',
  year: '2022',
};

function setup(overrides: Partial<DriversApi> = {}) {
  const api: DriversApi = {
    apply: vi.fn(async () => makeProfile()),
    getMe: vi.fn(async (): Promise<DriverProfile | null> => null),
    requestUploadUrl: vi.fn(),
    ...overrides,
  };
  let uploaded: ((document: DriverDocument) => void) | null = null;
  const controller = new OnboardingController({
    api,
    now: () => NOW,
    uploads: {
      onUploaded: (listener) => {
        uploaded = listener;
        return () => undefined;
      },
    },
  });
  return { api, controller, emitUploaded: (d: DriverDocument) => uploaded?.(d) };
}

describe('OnboardingController', () => {
  it('sin solicitud: perfil null y listo para el paso 1', async () => {
    const { controller } = setup();
    expect(controller.getState().status).toBe('idle');
    const loading = controller.refresh();
    expect(controller.getState().status).toBe('loading');
    await loading;
    expect(controller.getState()).toEqual({
      status: 'ready',
      profile: null,
      refreshing: false,
      error: null,
      notice: null,
    });
  });

  it('envía el vehículo validado y guarda el perfil devuelto', async () => {
    const { api, controller } = setup();
    const result = await controller.apply(form);
    expect(result.outcome).toBe('applied');
    expect(api.apply).toHaveBeenCalledWith({
      vehicleType: 'MOTOTAXI',
      plate: 'ABC12D',
      brand: 'Bajaj',
      model: 'RE 4S',
      color: 'Verde',
      year: 2022,
    });
    expect(controller.getState().profile).toEqual(makeProfile());
  });

  it('no llama a la API si el formulario no es válido', async () => {
    const { api, controller } = setup();
    const result = await controller.apply({ ...form, plate: 'ABC 123' });
    expect(result).toMatchObject({ outcome: 'invalid', errors: { plate: expect.any(String) } });
    expect(api.apply).not.toHaveBeenCalled();
  });

  it('DRIVER_ALREADY_APPLIED: recarga GET /drivers/me para precargar el formulario', async () => {
    const existing = makeProfile({ vehicle: { ...makeProfile().vehicle, brand: 'AKT' } });
    const { controller } = setup({
      apply: vi.fn(async () => {
        throw new ApiError('DRIVER_ALREADY_APPLIED', 'ya', 409);
      }),
      getMe: vi.fn(async () => existing),
    });
    const result = await controller.apply(form);
    expect(result).toMatchObject({ outcome: 'error', display: { kind: 'alreadyApplied' } });
    expect(controller.getState().profile).toEqual(existing);
  });

  it('PLATE_ALREADY_REGISTERED: error en el campo placa sin perfil', async () => {
    const { controller } = setup({
      apply: vi.fn(async () => {
        throw new ApiError('PLATE_ALREADY_REGISTERED', 'placa', 409);
      }),
    });
    const result = await controller.apply(form);
    expect(result).toMatchObject({
      outcome: 'error',
      display: { kind: 'field', field: 'plate' },
    });
    expect(controller.getState().profile).toBeNull();
  });

  it('sin red conserva el último perfil y muestra el aviso', async () => {
    const profile = makeProfile();
    const getMe = vi.fn<DriversApi['getMe']>(async () => profile);
    const { controller } = setup({ getMe });
    await controller.refresh();
    getMe.mockRejectedValueOnce(networkError());
    await controller.refresh();
    expect(controller.getState()).toMatchObject({
      status: 'ready',
      profile,
      error: expect.stringContaining('No hay conexión'),
    });
  });

  it('sin red y sin datos previos queda en error para reintentar', async () => {
    const { controller } = setup({
      getMe: vi.fn(async () => {
        throw networkError();
      }),
    });
    await controller.refresh();
    expect(controller.getState().status).toBe('error');
  });

  it('comparte un GET en curso y descarta respuestas viejas', async () => {
    const first = deferred<DriverProfile | null>();
    const getMe = vi.fn<DriversApi['getMe']>(() => first.promise);
    const { controller } = setup({ getMe });
    const a = controller.refresh();
    const b = controller.refresh();
    expect(getMe).toHaveBeenCalledTimes(1);
    // Mientras tanto POST /drivers/apply crea la solicitud: manda sobre el GET viejo.
    await controller.apply(form);
    first.resolve(null);
    await Promise.all([a, b]);
    expect(controller.getState().profile).toEqual(makeProfile());
  });

  it('refleja un documento subido de inmediato y lo confirma con la API', async () => {
    const confirmed = makeProfile({ documents: [makeDocument('CEDULA')] });
    const getMe = vi.fn<DriversApi['getMe']>(async () => makeProfile());
    const { controller, emitUploaded } = setup({ getMe });
    await controller.refresh();
    getMe.mockResolvedValue(confirmed);

    emitUploaded(makeDocument('CEDULA'));
    expect(controller.getState().profile?.documents).toEqual([makeDocument('CEDULA')]);
    expect(controller.getState().profile?.missingDocuments).not.toContain('CEDULA');
    await vi.waitFor(() => expect(getMe).toHaveBeenCalledTimes(2));
    await controller.refresh();
    expect(controller.getState().profile).toEqual(confirmed);
  });

  it('reset olvida el perfil (cierre de sesión)', async () => {
    const { controller } = setup({ getMe: vi.fn(async () => makeProfile()) });
    await controller.refresh();
    controller.reset();
    expect(controller.getState()).toEqual({
      status: 'idle',
      profile: null,
      refreshing: false,
      error: null,
      notice: null,
    });
  });
});

describe('mergeDocument', () => {
  it('reemplaza el documento del mismo tipo sin duplicarlo', () => {
    const profile = makeProfile({
      documents: [makeDocument('SOAT', { status: 'REJECTED', rejectionReason: 'Vencido' })],
    });
    expect(profile.missingDocuments).toContain('SOAT');
    const merged = mergeDocument(profile, makeDocument('SOAT'));
    expect(merged.documents).toEqual([makeDocument('SOAT')]);
    expect(merged.missingDocuments).not.toContain('SOAT');
  });
});
