// HU-305: dominio y caso de uso de rutas, con dobles en memoria (sin KV ni ORS).
import { ApiErrorCode, PLACES, RouteProfile, SNAP_WARNING_METERS } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { makeGetRoute } from '../../../src/modules/routing/application/get-route';
import { RouteProviderError } from '../../../src/modules/routing/application/ports';
import {
  colombiaDate,
  consumeRateWindow,
  isQuotaWarning,
  pointOutsideServiceArea,
  roundForLog,
  routeCacheKey,
  ROUTE_USER_LIMIT,
  assessRoute,
  shortestOf,
  type ProviderRoute,
} from '../../../src/modules/routing/domain/route';
import type { AppError } from '../../../src/shared/errors/app-error';
import {
  CENTRO_VGZ_PROVIDER_ROUTE,
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
    respond?: () => Promise<ProviderRoute> | ProviderRoute;
    quota?: number;
  } = {},
) {
  let now = NOW;
  const provider = new FakeRouteProvider(options.respond ?? (() => CENTRO_VGZ_PROVIDER_ROUTE));
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
    expect(a).toBe('route:v2:driving-car:4:10295,-766165:9789,-766053');
    expect(b).toBe(a);
    expect(routeCacheKey(CAR, PLACES.AIRPORT_VGZ, PLACES.VILLAGARZON_CENTER)).not.toBe(a);
    // -0.00001 redondea a 0, no a "-0".
    expect(routeCacheKey(CAR, { lat: -0.00001, lng: 0 }, { lat: 0, lng: 0 })).toBe(
      'route:v2:driving-car:4:0,0:0,0',
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

describe('calidad de la ruta (HU-307)', () => {
  const base: ProviderRoute = { ...CENTRO_VGZ_PROVIDER_ROUTE, alternatives: 3 };

  it('elige la de menor distancia; sin candidatas → null', () => {
    const routes = [
      { distanceMeters: 6612.8 },
      { distanceMeters: 5876.4 },
      { distanceMeters: 7240.5 },
    ];
    expect(shortestOf(routes)).toBe(routes[1]);
    expect(shortestOf([])).toBeNull();
  });

  it('ajuste a la vía: distancia al primer y al último vértice; factor contra la línea recta', () => {
    const route = assessRoute(PLACES.VILLAGARZON_CENTER, PLACES.AIRPORT_VGZ, base);
    expect(route).toEqual({
      ...CENTRO_VGZ_ROUTE,
      quality: { ...CENTRO_VGZ_ROUTE.quality, alternatives: 3 },
    });
    expect(route).not.toHaveProperty('alternatives');
  });

  it('ajuste lejano: el pin quedó a ~180 m de la vía donde empezó la ruta', () => {
    const pinLejano = {
      lat: PLACES.VILLAGARZON_CENTER.lat + 0.0016,
      lng: PLACES.VILLAGARZON_CENTER.lng,
    };
    const { quality } = assessRoute(pinLejano, PLACES.AIRPORT_VGZ, base);
    expect(quality.originSnapMeters).toBeGreaterThan(SNAP_WARNING_METERS);
    expect(quality.originSnapMeters).toBe(177);
    expect(quality.destinationSnapMeters).toBe(4);
  });

  it('ruta inusual: más de 2,5 veces la línea recta y al menos 1 km', () => {
    const lejos = assessRoute(PLACES.VILLAGARZON_CENTER, PLACES.AIRPORT_VGZ, {
      ...base,
      distanceMeters: 16_000,
    });
    expect(lejos.quality).toMatchObject({ unusual: true, detourRatio: 2.78 });
    // Trayecto corto: el factor se dispara pero no se marca.
    const corto = assessRoute(
      PLACES.VILLAGARZON_CENTER,
      { lat: PLACES.VILLAGARZON_CENTER.lat + 0.001, lng: PLACES.VILLAGARZON_CENTER.lng },
      { ...base, distanceMeters: 900 },
    );
    expect(corto.quality.unusual).toBe(false);
  });

  it('polilínea vacía o ilegible: ajuste 0', () => {
    for (const polyline of ['', '@@@\u0001']) {
      const { quality } = assessRoute(PLACES.VILLAGARZON_CENTER, PLACES.AIRPORT_VGZ, {
        ...base,
        polyline,
      });
      expect([quality.originSnapMeters, quality.destinationSnapMeters]).toEqual([0, 0]);
    }
  });

  it('redondeo del log a 4 decimales, sin "-0"', () => {
    expect(roundForLog({ lat: 1.029512345, lng: -76.616549 })).toEqual({
      lat: 1.0295,
      lng: -76.6165,
    });
    expect(Object.is(roundForLog({ lat: -0.00001, lng: 0 }).lat, 0)).toBe(true);
  });
});

describe('makeGetRoute', () => {
  it('ruta inusual: responde la marca, registra route_unusual redondeado y no lo repite desde la caché', async () => {
    const { getRoute, log } = setup({
      respond: () => ({ ...CENTRO_VGZ_PROVIDER_ROUTE, distanceMeters: 16_000, alternatives: 3 }),
    });
    const origin = { lat: 1.029512345, lng: -76.616549 };
    const route = await getRoute({ ...trip, origin });
    expect(route.quality).toMatchObject({ unusual: true, alternatives: 3 });
    expect(log.unusual).toEqual([
      {
        profile: CAR,
        origin: { lat: 1.0295, lng: -76.6165 },
        destination: PLACES.AIRPORT_VGZ,
        distanceMeters: 16_000,
        straightMeters: 5765,
        detourRatio: 2.78,
        originSnapMeters: 8,
        destinationSnapMeters: 4,
        alternatives: 3,
      },
    ]);
    expect((await getRoute({ ...trip, origin })).cached).toBe(true);
    expect(log.unusual).toHaveLength(1);
  });

  it('ruta normal: no registra route_unusual', async () => {
    const { getRoute, log } = setup();
    expect((await getRoute(trip)).quality.unusual).toBe(false);
    expect(log.unusual).toEqual([]);
  });

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
