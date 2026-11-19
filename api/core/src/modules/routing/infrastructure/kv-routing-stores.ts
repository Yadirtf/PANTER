import { ROUTE_CACHE_TTL_SECONDS } from '@panter/contracts';
import type {
  ProviderUsageCounter,
  RouteCache,
  RouteRateStore,
  RoutingLog,
} from '../application/ports';
import type { RateWindow, Route } from '../domain/route';

export const ORS_USAGE_PREFIX = 'ors:usage:';
export const ROUTE_RATE_PREFIX = 'route:rate:';
/** El contador del día vive 2 días: alcanza para revisarlo al día siguiente. */
export const ORS_USAGE_TTL_SECONDS = 2 * 24 * 60 * 60;
/** KV exige que la expiración esté al menos 60 s en el futuro. */
const KV_MIN_TTL_SECONDS = 60;

/** Caché de rutas en KV: la clave ya trae perfil y coordenadas redondeadas (domain/route.ts). */
export function createKvRouteCache(
  kv: KVNamespace,
  ttlSeconds: number = ROUTE_CACHE_TTL_SECONDS,
): RouteCache {
  return {
    get: (key) => kv.get<Route>(key, 'json'),
    put: (key, route) =>
      kv.put(key, JSON.stringify(route), {
        expirationTtl: Math.max(KV_MIN_TTL_SECONDS, ttlSeconds),
      }),
  };
}

/**
 * Contador diario de consultas reales a ORS: `ors:usage:<YYYY-MM-DD de Colombia>`. KV no tiene
 * incrementos atómicos: con consultas simultáneas el conteo puede quedarse corto por poco. Es
 * un indicador para los logs; el límite real lo aplica ORS (429).
 */
export function createKvUsageCounter(kv: KVNamespace): ProviderUsageCounter {
  return {
    async increment(date) {
      const key = ORS_USAGE_PREFIX + date;
      const current = Number((await kv.get(key)) ?? 0);
      const next = (Number.isFinite(current) ? current : 0) + 1;
      await kv.put(key, String(next), { expirationTtl: ORS_USAGE_TTL_SECONDS });
      return next;
    },
  };
}

/** Ventana fija del límite por usuario: `route:rate:<userId>`, expira al cerrar la ventana. */
export function createKvRouteRateStore(
  kv: KVNamespace,
  now: () => number = Date.now,
): RouteRateStore {
  return {
    get: (userId) => kv.get<RateWindow>(ROUTE_RATE_PREFIX + userId, 'json'),
    put: (userId, window) =>
      kv.put(ROUTE_RATE_PREFIX + userId, JSON.stringify(window), {
        expiration: Math.ceil(Math.max(window.resetAt, now() + KV_MIN_TTL_SECONDS * 1000) / 1000),
      }),
  };
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Logs estructurados (Workers Logs los indexa por campo: busca `ors_request`). */
export function createConsoleRoutingLog(): RoutingLog {
  return {
    providerRequest: (entry) => console.log({ event: 'ors_request', ...entry }),
    quotaWarning: (entry) =>
      console.warn({
        event: 'ors_quota_warning',
        ...entry,
        message: `Se usó el ${Math.round((entry.count / entry.quota) * 100)} % de la cuota diaria de OpenRouteService.`,
      }),
    notConfigured: (message) => console.error({ event: 'routing_not_configured', message }),
    storageError: (operation, error) =>
      console.warn({ event: 'routing_storage_error', operation, error: errorText(error) }),
  };
}
