import type { Env } from '../env';
import { makeGetRoute, type GetRoute } from '../modules/routing/application/get-route';
import type { Clock, RouteProvider, RoutingLog } from '../modules/routing/application/ports';
import type { RoutingFactories } from '../modules/routing/http/routes';
import {
  createKvRouteCache,
  createKvRouteRateStore,
  createKvUsageCounter,
  createConsoleRoutingLog,
} from '../modules/routing/infrastructure/kv-routing-stores';
import {
  createOrsRouteProvider,
  type FetchLike,
} from '../modules/routing/infrastructure/openrouteservice-route-provider';

/** Adaptadores reemplazables en pruebas (fetch simulado de ORS, reloj, logs). */
export interface RoutingOverrides {
  fetch?: FetchLike;
  provider?: (env: Env) => RouteProvider;
  log?: RoutingLog;
  clock?: Clock;
  quota?: number;
}

/**
 * Caso de uso "ruta" armado para el request (HU-305). Lo usan GET /routes y el estimado de
 * tarifa (HU-402), así los dos comparten la caché y el contador de ORS. Sin ORS_API_KEY la
 * ruta responde 503 ROUTING_UNAVAILABLE (y el log dice qué falta); el resto de la API sigue.
 */
export function buildGetRoute(env: Env, overrides: RoutingOverrides = {}): GetRoute {
  const { clock } = overrides;
  const provider =
    overrides.provider?.(env) ??
    createOrsRouteProvider({ apiKey: env.ORS_API_KEY, fetch: overrides.fetch, now: clock });
  return makeGetRoute({
    provider,
    cache: createKvRouteCache(env.KV),
    usage: createKvUsageCounter(env.KV),
    rate: createKvRouteRateStore(env.KV, clock),
    log: overrides.log ?? createConsoleRoutingLog(),
    clock,
    quota: overrides.quota,
  });
}

/** Raíz de composición del módulo routing. */
export function buildRoutingFactories(overrides: RoutingOverrides = {}): RoutingFactories {
  return { getRoute: (env) => buildGetRoute(env, overrides) };
}
