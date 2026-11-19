// HU-402: caso de uso del estimado y caché de tarifas en memoria del isolate.
import { ApiErrorCode, FareEstimateResponseSchema, PLACES } from '@panter/contracts';
import { describe, expect, it, vi } from 'vitest';
import { makeUpdateFareRule } from '../../../src/modules/pricing/application/admin-fares';
import { makeEstimateFare } from '../../../src/modules/pricing/application/estimate-fare';
import type { RouteSource } from '../../../src/modules/pricing/application/ports';
import {
  createCachedFareCatalog,
  FareCache,
} from '../../../src/modules/pricing/infrastructure/memory-fare-catalog';
import type { AppError } from '../../../src/shared/errors/app-error';
import { CENTRO_VGZ_ROUTE } from '../../support/routing-fakes';
import { memoryPricing, SEED_RULES } from '../../support/pricing-fakes';

const NOW = Date.parse('2026-11-18T19:00:00Z'); // 2:00 p. m. en Villagarzón
const ADMIN_ID = '00000000-0000-4000-8000-00000000aaaa';

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error('se esperaba un error');
}

function setup() {
  let now = NOW;
  const repos = memoryPricing();
  repos.store.admins.set(ADMIN_ID, 'admin@panter.test');
  const cache = new FareCache();
  const listRules = vi.spyOn(repos.rules, 'list');
  const route = vi.fn<RouteSource>(async () => CENTRO_VGZ_ROUTE);
  const clock = () => now;
  const estimate = makeEstimateFare({
    catalog: createCachedFareCatalog({
      rules: repos.rules,
      geofences: repos.geofences,
      cache,
      now: clock,
    }),
    route,
    clock,
  });
  return {
    ...repos,
    cache,
    listRules,
    route,
    estimate,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const trip = {
  origin: PLACES.VILLAGARZON_CENTER,
  destination: PLACES.AIRPORT_VGZ,
  vehicleType: 'TAXI' as const,
};

describe('makeEstimateFare', () => {
  it('taxi centro → aeropuerto: total, desglose, ruta y vigencia de 10 minutos', async () => {
    const { estimate, route } = setup();
    const result = FareEstimateResponseSchema.parse(await estimate('u-1', trip));
    expect(result).toMatchObject({
      vehicleType: 'TAXI',
      currency: 'COP',
      total: 19500,
      isNight: false,
      route: {
        distanceMeters: 5876.4,
        durationSeconds: 548.9,
        polyline: CENTRO_VGZ_ROUTE.polyline,
      },
      validUntil: '2026-11-18T19:10:00.000Z',
    });
    expect(result.breakdown.map((x) => x.code)).toContain('AIRPORT');
    expect(route).toHaveBeenCalledWith({
      userId: 'u-1',
      origin: trip.origin,
      destination: trip.destination,
    });
  });

  it('departAt: reserva nocturna; en el pasado usa la hora actual; fuera de rango → 400', async () => {
    const { estimate } = setup();
    const night = await estimate('u', { ...trip, departAt: '2026-11-19T03:00:00Z' });
    expect(night.isNight).toBe(true);
    const past = await estimate('u', { ...trip, departAt: '2026-11-18T18:57:00Z' });
    expect(past.isNight).toBe(false);
    for (const departAt of ['2026-11-18T18:00:00Z', '2026-12-01T00:00:00Z']) {
      const err = await failure(estimate('u', { ...trip, departAt }));
      expect([err.status, err.code]).toEqual([400, ApiErrorCode.VALIDATION_ERROR]);
    }
  });

  it('regla inactiva o inexistente → 404 FARE_RULE_NOT_FOUND sin pedir la ruta', async () => {
    const { estimate, route, store } = setup();
    store.rules.delete('MOTOTAXI');
    const jeep = await failure(estimate('u', { ...trip, vehicleType: 'JEEP_4X4' }));
    expect([jeep.status, jeep.code]).toEqual([404, ApiErrorCode.FARE_RULE_NOT_FOUND]);
    expect((await failure(estimate('u', { ...trip, vehicleType: 'MOTOTAXI' }))).code).toBe(
      ApiErrorCode.FARE_RULE_NOT_FOUND,
    );
    expect(route).not.toHaveBeenCalled();
  });

  it('los errores de la ruta se propagan (p. ej. fuera del área)', async () => {
    const { estimate, route } = setup();
    route.mockRejectedValueOnce(new Error('ruta'));
    await expect(estimate('u', trip)).rejects.toThrow('ruta');
  });
});

describe('caché de tarifas del isolate (60 s)', () => {
  it('reutiliza reglas y geocercas durante 60 s y vuelve a cargar después', async () => {
    const { estimate, listRules, store, advance } = setup();
    await estimate('u', trip);
    await estimate('u', trip);
    expect(listRules).toHaveBeenCalledTimes(1);
    expect(store.coveringCalls).toBe(1);
    advance(60_000);
    await estimate('u', trip);
    expect(listRules).toHaveBeenCalledTimes(2);
    expect(store.coveringCalls).toBe(2);
  });

  it('se invalida al editar una regla', async () => {
    const { estimate, rules, cache } = setup();
    expect((await estimate('u', trip)).total).toBe(19500);
    const update = makeUpdateFareRule({ rules, onChange: () => cache.invalidate() });
    const { vehicleType: _v, updatedAt: _a, updatedBy: _b, ...taxi } = SEED_RULES[1]!;
    await update({ userId: ADMIN_ID, roles: ['ADMIN'], activeMode: 'passenger' }, 'TAXI', {
      ...taxi,
      baseFare: 7000,
    });
    expect((await estimate('u', trip)).total).toBe(20500);
  });

  it('guarda un máximo de consultas de geocercas (las más viejas salen primero)', async () => {
    const cache = new FareCache(60_000, 2);
    const load = vi.fn(async () => []);
    await cache.getCoverage('a', 0, load);
    await cache.getCoverage('b', 0, load);
    await cache.getCoverage('c', 0, load);
    await cache.getCoverage('c', 1, load);
    expect(load).toHaveBeenCalledTimes(3);
    await cache.getCoverage('a', 1, load);
    expect(load).toHaveBeenCalledTimes(4);
  });
});
