// HU-305: dominio y caso de uso de rutas, con dobles en memoria (sin KV ni ORS).
import { ApiErrorCode, PLACES, RouteProfile } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { makeGetRoute } from '../../../src/modules/routing/application/get-route';
import { RouteProviderError } from '../../../src/modules/routing/application/ports';
import {
  colombiaDate,
  consumeRateWindow,
  isQuotaWarning,
  pointOutsideServiceArea,
  routeCacheKey,
  ROUTE_USER_LIMIT,
} from '../../../src/modules/routing/domain/route';
import type { AppError } from '../../../src/shared/errors/app-error';
import {
  CENTRO_VGZ_ROUTE,
  FakeRouteProvider,
  MemoryRateStore,
  MemoryRouteCache,
  MemoryUsageCounter,
  RecordingRoutingLog,
} from '../../support/routing-fakes';

const NOW = Date.parse('2026-11-18T22:00:00Z'); // 5:00 p. m. en Villagarzón
const CAR = RouteProfile.CAR;
const trip = {
  userId: 'u-1',
  origin: PLACES.VILLAGARZON_CENTER,
  destination: PLACES.AIRPORT_VGZ,
  profile: CAR,
};

function setup(
  options: {
    respond?: () => Promise<typeof CENTRO_VGZ_ROUTE> | typeof CENTRO_VGZ_ROUTE;
    quota?: number;
  } = {},
) {
  let now = NOW;
  const provider = new FakeRouteProvider(options.respond ?? (() => CENTRO_VGZ_ROUTE));
  const cache = new MemoryRouteCache();
  const usage = new MemoryUsageCounter();
  const rate = new MemoryRateStore();
  const log = new RecordingRoutingLog();
  const getRoute = makeGetRoute({
    provider,
    cache,
    usage,
    rate,
    log,
    clock: () => now,
    quota: options.quota,
  });
  return {
    getRoute,
    provider,
    cache,
    usage,
    rate,
    log,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error('se esperaba un error');
}

describe('dominio de rutas', () => {
  it('clave de caché: perfil y par redondeado a 4 decimales (≈ 11 m), con sentido', () => {
    const a = routeCacheKey(CAR, { lat: 1.02951, lng: -76.61648 }, PLACES.AIRPORT_VGZ);
    const b = routeCacheKey(CAR, { lat: 1.029514, lng: -76.616476 }, PLACES.AIRPORT_VGZ);
    expect(a).toBe('route:v1:driving-car:4:10295,-766165:9789,-766053');
    expect(b).toBe(a);
    expect(routeCacheKey(CAR, PLACES.AIRPORT_VGZ, PLACES.VILLAGARZON_CENTER)).not.toBe(a);
    // -0.00001 redondea a 0, no a "-0".
    expect(routeCacheKey(CAR, { lat: -0.00001, lng: 0 }, { lat: 0, lng: 0 })).toBe(
      'route:v1:driving-car:4:0,0:0,0',
    );
  });

  it('fecha de Colombia: a las 11 p. m. del 18 en Villagarzón ya es 19 en UTC', () => {
    expect(colombiaDate(Date.parse('2026-11-19T04:00:00Z'))).toBe('2026-11-18');
    expect(colombiaDate(Date.parse('2026-11-19T05:00:00Z'))).toBe('2026-11-19');
  });

  it('aviso desde el 80 % de la cuota', () => {
    expect(isQuotaWarning(1599, 2000)).toBe(false);
    expect(isQuotaWarning(1600, 2000)).toBe(true);
    expect(isQuotaWarning(1600)).toBe(true);
  });

  it('área de servicio: dice qué punto quedó fuera', () => {
    const bogota = { lat: 4.711, lng: -74.0721 };
    expect(pointOutsideServiceArea(PLACES.MOCOA_CENTER, PLACES.PUERTO_ASIS_CENTER)).toBeNull();
    expect(pointOutsideServiceArea(bogota, PLACES.AIRPORT_VGZ)).toBe('origin');
    expect(pointOutsideServiceArea(PLACES.AIRPORT_VGZ, bogota)).toBe('destination');
  });

  it('ventana fija del límite por usuario', () => {
    let window = null;
    for (let i = 0; i < ROUTE_USER_LIMIT; i++) {
      const d = consumeRateWindow(window, NOW);
      expect(d.allowed).toBe(true);
      window = d.allowed ? d.window : null;
    }
    expect(consumeRateWindow(window, NOW + 1000)).toEqual({
      allowed: false,
      retryAfterSeconds: 3599,
    });
    // Al cerrar la ventana vuelve a empezar.
    const reset = consumeRateWindow(window, NOW + 3600 * 1000);
    expect(reset).toMatchObject({ allowed: true, window: { count: 1 } });
  });
});

describe('makeGetRoute', () => {
  it('consulta ORS, guarda en caché y la segunda vez responde cached sin gastar cuota', async () => {
    const { getRoute, provider, usage, log } = setup();
    expect(await getRoute(trip)).toEqual({ ...CENTRO_VGZ_ROUTE, cached: false });
    const again = await getRoute({
      ...trip,
      userId: 'u-2',
      origin: { lat: 1.02951, lng: -76.6165 },
    });
    expect(again).toEqual({ ...CENTRO_VGZ_ROUTE, cached: true });
    expect(provider.calls).toHaveLength(1);
    expect(usage.days.get('2026-11-18')).toBe(1);
    expect(log.requests).toEqual([
      { date: '2026-11-18', count: 1, quota: 2000, outcome: 'ok', status: 200, durationMs: 0 },
    ]);
    expect(log.warnings).toEqual([]);
  });

  it('origen o destino fuera del área → 422 OUT_OF_SERVICE_AREA sin llamar a ORS', async () => {
    const { getRoute, provider } = setup();
    const err = await failure(getRoute({ ...trip, destination: { lat: 4.711, lng: -74.07 } }));
    expect([err.status, err.code, err.details]).toEqual([
      422,
      ApiErrorCode.OUT_OF_SERVICE_AREA,
      { point: 'destination' },
    ]);
    expect(provider.calls).toHaveLength(0);
  });

  it('avisa en el log desde el 80 % de la cuota', async () => {
    const { getRoute, usage, log } = setup({ quota: 10 });
    usage.days.set('2026-11-18', 7);
    await getRoute(trip);
    expect(log.warnings).toEqual([{ date: '2026-11-18', count: 8, quota: 10 }]);
  });

  it('sin ruta → 422 ROUTE_NOT_FOUND (la consulta cuenta)', async () => {
    const { getRoute, log } = setup({
      respond: () => Promise.reject(new RouteProviderError('not_found', 'x', { status: 404 })),
    });
    const err = await failure(getRoute(trip));
    expect([err.status, err.code]).toEqual([422, ApiErrorCode.ROUTE_NOT_FOUND]);
    expect(log.requests[0]).toMatchObject({ outcome: 'not_found', status: 404, count: 1 });
  });

  it('ORS caído o sin cuota → 503 ROUTING_UNAVAILABLE con el Retry-After de ORS', async () => {
    const { getRoute, cache } = setup({
      respond: () =>
        Promise.reject(
          new RouteProviderError('unavailable', 'x', { status: 429, retryAfterSeconds: 42 }),
        ),
    });
    const err = await failure(getRoute(trip));
    expect([err.status, err.code, err.details]).toEqual([
      503,
      ApiErrorCode.ROUTING_UNAVAILABLE,
      { retryAfterSeconds: 42 },
    ]);
    expect(cache.entries.size).toBe(0);
  });

  it('sin ORS_API_KEY → 503 con log claro y sin contar consulta', async () => {
    const { getRoute, usage, log } = setup({
      respond: () => Promise.reject(new RouteProviderError('not_configured', 'Falta ORS_API_KEY')),
    });
    const err = await failure(getRoute(trip));
    expect([err.status, err.code, err.details]).toEqual([
      503,
      ApiErrorCode.ROUTING_UNAVAILABLE,
      undefined,
    ]);
    expect(log.notConfiguredMessages).toEqual(['Falta ORS_API_KEY']);
    expect(usage.days.size).toBe(0);
  });

  it('errores que no son del proveedor se propagan', async () => {
    const { getRoute } = setup({ respond: () => Promise.reject(new TypeError('bug')) });
    await expect(getRoute(trip)).rejects.toThrow(TypeError);
  });

  it('límite por usuario: la consulta 21 de la hora → 429 con Retry-After', async () => {
    const { getRoute, advance, provider } = setup();
    for (let i = 0; i < ROUTE_USER_LIMIT; i++) {
      await getRoute({ ...trip, destination: { lat: 1 + i / 1000, lng: -76.6 } });
    }
    advance(60_000);
    const err = await failure(getRoute({ ...trip, destination: { lat: 1.2, lng: -76.6 } }));
    expect([err.status, err.code, err.details]).toEqual([
      429,
      ApiErrorCode.ROUTING_UNAVAILABLE,
      { retryAfterSeconds: 3540 },
    ]);
    expect(err.message).toContain('59 minutos');
    // Lo que está en caché se sigue respondiendo, y otro usuario no está limitado.
    expect((await getRoute({ ...trip, destination: { lat: 1, lng: -76.6 } })).cached).toBe(true);
    expect(
      (await getRoute({ ...trip, userId: 'u-9', destination: { lat: 1.2, lng: -76.6 } })).cached,
    ).toBe(false);
    expect(provider.calls).toHaveLength(ROUTE_USER_LIMIT + 1);
  });

  it('si KV falla, la ruta se calcula igual y se registra el error', async () => {
    const { getRoute, cache, usage, rate, log } = setup();
    const boom = () => Promise.reject(new Error('KV caído'));
    cache.get = boom;
    cache.put = boom;
    usage.increment = boom;
    rate.get = boom;
    rate.put = boom;
    expect((await getRoute(trip)).cached).toBe(false);
    expect(log.storageErrors).toEqual([
      'route_cache_get',
      'route_rate_get',
      'route_rate_put',
      'ors_usage_increment',
      'route_cache_put',
    ]);
    expect(log.requests[0]).toMatchObject({ count: -1 });
    expect(log.warnings).toEqual([]);
  });
});
