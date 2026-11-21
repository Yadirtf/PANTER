import { haversineMeters, ORS_DAILY_QUOTA, type LatLng } from '@panter/contracts';
import {
  assessRoute,
  colombiaDate,
  consumeRateWindow,
  isQuotaWarning,
  pointOutsideServiceArea,
  roundForLog,
  routeCacheKey,
  type ProviderRoute,
  type Route,
} from '../domain/route';
import { RoutingErrors } from './errors';
import {
  RouteProviderError,
  type Clock,
  type ProviderUsageCounter,
  type RouteCache,
  type RouteProfileName,
  type RouteProvider,
  type RouteRateStore,
  type RoutingLog,
} from './ports';

export interface GetRouteInput {
  /** Quien consulta: el límite de consultas reales es por usuario. */
  userId: string;
  origin: LatLng;
  destination: LatLng;
  profile: RouteProfileName;
}

/** GET /routes (y el estimado de tarifa, HU-402): ruta con caché y cuota protegida. */
export type GetRoute = (input: GetRouteInput) => Promise<Route & { cached: boolean }>;

export interface GetRouteDeps {
  provider: RouteProvider;
  cache: RouteCache;
  usage: ProviderUsageCounter;
  rate: RouteRateStore;
  log: RoutingLog;
  clock?: Clock;
  quota?: number;
}

/**
 * Ruta entre dos puntos del área de servicio (HU-305, §6.2):
 * 1. Origen y destino fuera de SERVICE_AREA → 422 `OUT_OF_SERVICE_AREA` (sin gastar cuota).
 * 2. Caché KV de 10 minutos por perfil y par redondeado: si está, `cached: true`.
 * 3. Límite por usuario de consultas reales (20 por hora) → 429 `ROUTING_UNAVAILABLE`.
 * 4. Consulta a ORS. Cada consulta real suma al contador diario (fecha de Colombia), se
 *    registra en un log estructurado y, desde el 80 % de la cuota, se avisa con un warning.
 * 5. Sin ruta → 422 `ROUTE_NOT_FOUND`; error, cuota o falta de clave → 503 `ROUTING_UNAVAILABLE`.
 * 6. HU-307: el proveedor devuelve la más corta de sus alternativas (una sola consulta); aquí se
 *    calcula la calidad (ajuste a la vía y factor contra la línea recta) y, si la ruta es
 *    inusual, se registra `route_unusual` con origen y destino redondeados. La calidad se
 *    guarda con la ruta en la caché (clave con `ROUTE_CACHE_VERSION`).
 *
 * KV es la caché y el contador; si falla, la ruta se sigue calculando (se registra el error).
 */
export function makeGetRoute(deps: GetRouteDeps): GetRoute {
  const now = deps.clock ?? Date.now;
  const quota = deps.quota ?? ORS_DAILY_QUOTA;

  async function safely<T>(operation: string, run: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await run();
    } catch (error) {
      deps.log.storageError(operation, error);
      return fallback;
    }
  }

  return async ({ userId, origin, destination, profile }) => {
    const outside = pointOutsideServiceArea(origin, destination);
    if (outside) throw RoutingErrors.outOfServiceArea(outside);

    const key = routeCacheKey(profile, origin, destination);
    const hit = await safely('route_cache_get', () => deps.cache.get(key), null);
    if (hit) return { ...hit, cached: true };

    const window = await safely('route_rate_get', () => deps.rate.get(userId), null);
    const decision = consumeRateWindow(window, now());
    if (!decision.allowed) throw RoutingErrors.rateLimited(decision.retryAfterSeconds);
    await safely('route_rate_put', () => deps.rate.put(userId, decision.window), undefined);

    const started = now();
    let found: ProviderRoute;
    try {
      found = await deps.provider.route({ origin, destination, profile });
    } catch (error) {
      if (!(error instanceof RouteProviderError)) throw error;
      if (error.reason === 'not_configured') {
        deps.log.notConfigured(error.message);
        throw RoutingErrors.unavailable();
      }
      await count(error.reason, started, error.status);
      if (error.reason === 'not_found') throw RoutingErrors.routeNotFound();
      throw RoutingErrors.unavailable(error.retryAfterSeconds);
    }
    await count('ok', started, 200);
    const route = assessRoute(origin, destination, found);
    if (route.quality.unusual) {
      deps.log.unusualRoute({
        profile,
        origin: roundForLog(origin),
        destination: roundForLog(destination),
        distanceMeters: Math.round(route.distanceMeters),
        straightMeters: Math.round(haversineMeters(origin, destination)),
        detourRatio: route.quality.detourRatio,
        originSnapMeters: route.quality.originSnapMeters,
        destinationSnapMeters: route.quality.destinationSnapMeters,
        alternatives: route.quality.alternatives,
      });
    }
    await safely('route_cache_put', () => deps.cache.put(key, route), undefined);
    return { ...route, cached: false };
  };

  async function count(
    outcome: 'ok' | 'not_found' | 'unavailable',
    started: number,
    status: number | undefined,
  ) {
    const date = colombiaDate(started);
    const total = await safely('ors_usage_increment', () => deps.usage.increment(date), -1);
    deps.log.providerRequest({
      date,
      count: total,
      quota,
      outcome,
      ...(status === undefined ? {} : { status }),
      durationMs: now() - started,
    });
    if (total >= 0 && isQuotaWarning(total, quota)) {
      deps.log.quotaWarning({ date, count: total, quota });
    }
  }
}
