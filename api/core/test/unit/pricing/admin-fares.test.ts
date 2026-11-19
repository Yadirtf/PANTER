// HU-401: reglas de negocio de tarifas y geocercas, y casos de uso de administración.
import { ApiErrorCode, Role, type FareRuleUpdateBody } from '@panter/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  makeGetFareConfig,
  makeListFareHistory,
  makeUpdateFareRule,
  makeUpdateGeofence,
} from '../../../src/modules/pricing/application/admin-fares';
import type { Actor } from '../../../src/modules/auth/domain/actor';
import type { GeofenceRepository } from '../../../src/modules/pricing/application/ports';
import {
  fareRuleIssues,
  normalizeVehicleTypes,
  polygonIssues,
} from '../../../src/modules/pricing/domain/fare-policy';
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
} from '../../../src/modules/pricing/domain/history-cursor';
import type { AppError } from '../../../src/shared/errors/app-error';
import { AIRPORT_ID, memoryPricing, SEED_GEOFENCES, SEED_RULES } from '../../support/pricing-fakes';

const ADMIN_ID = '00000000-0000-4000-8000-00000000aaaa';
const admin: Actor = { userId: ADMIN_ID, roles: [Role.ADMIN], activeMode: 'passenger' };

const taxi: FareRuleUpdateBody = (({ vehicleType: _v, updatedAt: _a, updatedBy: _b, ...r }) => r)(
  SEED_RULES[1]!,
);
const moto: FareRuleUpdateBody = (({ vehicleType: _v, updatedAt: _a, updatedBy: _b, ...r }) => r)(
  SEED_RULES[0]!,
);
const airport = (({ id: _id, kind: _k, ...g }) => g)(SEED_GEOFENCES[0]!);

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error('se esperaba un error');
}

function setup() {
  const repos = memoryPricing();
  repos.store.admins.set(ADMIN_ID, 'admin@panter.test');
  const onChange = vi.fn();
  return {
    ...repos,
    onChange,
    updateRule: makeUpdateFareRule({ rules: repos.rules, onChange }),
    updateGeofence: makeUpdateGeofence({ geofences: repos.geofences, onChange }),
    history: makeListFareHistory({ changes: repos.changes }),
  };
}

describe('reglas de negocio de la tarifa', () => {
  it('las semillas son válidas', () => {
    expect(fareRuleIssues(taxi)).toEqual([]);
    expect(fareRuleIssues(moto)).toEqual([]);
  });

  it('roundTo debe dividir $1.000', () => {
    for (const roundTo of [1, 50, 100, 250, 500, 1000]) {
      expect(fareRuleIssues({ ...taxi, roundTo })).toEqual([]);
    }
    for (const roundTo of [0, 300, 700, 999]) {
      expect(fareRuleIssues({ ...taxi, roundTo }).map((i) => i.code)).toEqual([
        'round_to_not_divisor',
      ]);
    }
  });

  it('FLAT con perKm o perMinute distinto de 0 no es válido', () => {
    expect(fareRuleIssues({ ...moto, perKm: 500, perMinute: 50 }).map((i) => i.path)).toEqual([
      'perKm',
      'perMinute',
    ]);
  });

  it('montos negativos o con decimales; horario nocturno vacío con recargo', () => {
    expect(fareRuleIssues({ ...taxi, minimumFare: -1, baseFare: 10.5 }).map((i) => i.path)).toEqual(
      ['baseFare', 'minimumFare'],
    );
    expect(fareRuleIssues({ ...taxi, nightEndMinute: 1200 }).map((i) => i.code)).toEqual([
      'empty_night_window',
    ]);
    expect(fareRuleIssues({ ...taxi, nightEndMinute: 1200, nightSurcharge: 0 })).toEqual([]);
  });
});

describe('validación del polígono', () => {
  it('anillos de al menos 3 vértices distintos y dentro del área de servicio', () => {
    expect(polygonIssues(airport.polygon)).toEqual([]);
    expect(polygonIssues(SEED_GEOFENCES[1]!.polygon)).toEqual([]);
    expect(polygonIssues([])[0]!.code).toBe('empty_polygon');
    const p = { lat: 1, lng: -76.6 };
    const q = { lat: 1.01, lng: -76.6 };
    expect(polygonIssues([[p, q, p]]).map((i) => i.code)).toEqual(['ring_too_small']);
    const bogota = { lat: 4.711, lng: -74.07 };
    expect(polygonIssues([[p, q, bogota]])).toEqual([
      expect.objectContaining({ path: 'polygon.0.2', code: 'outside_service_area' }),
    ]);
  });

  it('tipos de vehículo sin repetir y en orden', () => {
    expect(normalizeVehicleTypes(['TAXI', 'MOTOTAXI', 'TAXI'])).toEqual(['MOTOTAXI', 'TAXI']);
  });
});

describe('cursor del historial', () => {
  it('ida y vuelta, y rechaza cursores alterados', () => {
    const cursor = { changedAt: '2026-11-18T12:00:00.123456Z', id: AIRPORT_ID };
    expect(decodeHistoryCursor(encodeHistoryCursor(cursor))).toEqual(cursor);
    expect(decodeHistoryCursor('%%%')).toBeNull();
    expect(decodeHistoryCursor(btoa('{"t":1,"i":"x"}'))).toBeNull();
    expect(decodeHistoryCursor(btoa('{"t":"ayer","i":"x"}'))).toBeNull();
  });
});

describe('casos de uso de administración', () => {
  it('GET /admin/fares devuelve reglas y geocercas', async () => {
    const { rules, geofences } = setup();
    const config = await makeGetFareConfig({ rules, geofences })();
    expect(config.rules.map((r) => r.vehicleType)).toEqual(['MOTOTAXI', 'TAXI', 'JEEP_4X4']);
    expect(config.geofences).toHaveLength(2);
  });

  it('edita una regla, registra el historial e invalida la caché', async () => {
    const { updateRule, store, onChange } = setup();
    const saved = await updateRule(admin, 'TAXI', { ...taxi, perKm: 1300 });
    expect(saved).toMatchObject({ perKm: 1300, updatedBy: 'admin@panter.test' });
    expect(store.changes[0]).toMatchObject({
      entity: 'FARE_RULE',
      entityKey: 'TAXI',
      before: { perKm: 1200 },
      after: { perKm: 1300 },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    // Sin cambios: ni historial ni invalidación.
    await updateRule(admin, 'TAXI', { ...taxi, perKm: 1300 });
    expect(store.changes).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('errores al editar una regla', async () => {
    const { updateRule, store } = setup();
    const invalid = await failure(updateRule(admin, 'MOTOTAXI', { ...moto, perKm: 100 }));
    expect([invalid.status, invalid.code]).toEqual([400, ApiErrorCode.VALIDATION_ERROR]);
    expect(invalid.details).toEqual([expect.objectContaining({ path: 'perKm' })]);

    const other: Actor = { ...admin, userId: '00000000-0000-4000-8000-00000000bbbb' };
    expect((await failure(updateRule(other, 'TAXI', taxi))).code).toBe(ApiErrorCode.FORBIDDEN);

    store.rules.delete('JEEP_4X4');
    const missing = await failure(updateRule(admin, 'JEEP_4X4', taxi));
    expect([missing.status, missing.code]).toEqual([404, ApiErrorCode.FARE_RULE_NOT_FOUND]);
  });

  it('si la regla desaparece justo después de editarla → 404', async () => {
    const { rules } = setup();
    rules.get = async () => null;
    const update = makeUpdateFareRule({ rules });
    expect((await failure(update(admin, 'TAXI', { ...taxi, perKm: 1 }))).code).toBe(
      ApiErrorCode.FARE_RULE_NOT_FOUND,
    );
  });

  it('edita una geocerca normalizando nombre y vehículos', async () => {
    const { updateGeofence, store, onChange } = setup();
    const saved = await updateGeofence(admin, AIRPORT_ID, {
      ...airport,
      name: '  Aeropuerto VGZ ',
      surcharge: 6000,
      appliesTo: ['TAXI', 'MOTOTAXI', 'TAXI'],
    });
    expect(saved).toMatchObject({
      name: 'Aeropuerto VGZ',
      surcharge: 6000,
      appliesTo: ['MOTOTAXI', 'TAXI'],
      kind: 'AIRPORT',
    });
    expect(store.changes[0]).toMatchObject({
      entity: 'GEOFENCE',
      before: { surcharge: 5000 },
      after: { surcharge: 6000 },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('sin polígono (cuerpo de la web): conserva el área', async () => {
    const { updateGeofence } = setup();
    const { polygon: _polygon, ...withoutPolygon } = airport;
    const saved = await updateGeofence(admin, AIRPORT_ID, { ...withoutPolygon, active: false });
    expect(saved).toMatchObject({ active: false, polygon: airport.polygon });
  });

  it('errores al editar una geocerca', async () => {
    const { updateGeofence, store } = setup();
    const outside = await failure(
      updateGeofence(admin, AIRPORT_ID, {
        ...airport,
        polygon: [[{ lat: 4.7, lng: -74 }, ...airport.polygon[0]!]],
      }),
    );
    expect([outside.status, outside.code]).toEqual([400, ApiErrorCode.VALIDATION_ERROR]);

    store.polygonReason = 'Self-intersection[-76.605 0.979]';
    const bowtie = await failure(updateGeofence(admin, AIRPORT_ID, airport));
    expect(bowtie.details).toEqual([
      expect.objectContaining({
        code: 'invalid_geometry',
        message: expect.stringContaining('Self-intersection'),
      }),
    ]);
    store.polygonReason = null;

    const other: Actor = { ...admin, userId: '00000000-0000-4000-8000-00000000bbbb' };
    expect((await failure(updateGeofence(other, AIRPORT_ID, airport))).code).toBe(
      ApiErrorCode.FORBIDDEN,
    );
    const missing = await failure(updateGeofence(admin, crypto.randomUUID(), airport));
    expect([missing.status, missing.code]).toEqual([404, ApiErrorCode.NOT_FOUND]);
  });

  it('PostGIS sin motivo y geocerca borrada después de editarla', async () => {
    const geofences: GeofenceRepository = setup().geofences;
    const update = makeUpdateGeofence({ geofences });
    geofences.update = async () => ({
      actorIsAdmin: true,
      exists: true,
      changed: false,
      polygonValid: false,
      polygonReason: null,
    });
    expect((await failure(update(admin, AIRPORT_ID, airport))).details).toEqual([
      expect.objectContaining({ message: expect.stringContaining('geometría inválida') }),
    ]);
    geofences.update = async () => ({
      actorIsAdmin: true,
      exists: true,
      changed: true,
      polygonValid: true,
      polygonReason: null,
    });
    geofences.get = async () => null;
    expect((await failure(update(admin, AIRPORT_ID, airport))).status).toBe(404);
  });

  it('historial con cursor', async () => {
    const { updateRule, history } = setup();
    for (const perKm of [1250, 1300, 1350]) await updateRule(admin, 'TAXI', { ...taxi, perKm });
    const first = await history({ limit: 2 });
    expect(first.items.map((c) => (c.after as { perKm: number }).perKm)).toEqual([1350, 1300]);
    const second = await history({ limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((c) => (c.after as { perKm: number }).perKm)).toEqual([1250]);
    expect(second.nextCursor).toBeNull();
    expect((await failure(history({ limit: 2, cursor: 'xx' }))).code).toBe(
      ApiErrorCode.VALIDATION_ERROR,
    );
  });
});
