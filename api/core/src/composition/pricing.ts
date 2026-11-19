import type { Env } from '../env';
import {
  makeGetFareConfig,
  makeListFareHistory,
  makeUpdateFareRule,
  makeUpdateGeofence,
  type OnFareConfigChange,
} from '../modules/pricing/application/admin-fares';
import type {
  FareChangeRepository,
  FareRuleRepository,
  GeofenceRepository,
} from '../modules/pricing/application/ports';
import type { PricingAdminFactories } from '../modules/pricing/http/admin-routes';
import { createDrizzleFareChangeRepository } from '../modules/pricing/infrastructure/drizzle-fare-change-repository';
import { createDrizzleFareRuleRepository } from '../modules/pricing/infrastructure/drizzle-fare-rule-repository';
import { createDrizzleGeofenceRepository } from '../modules/pricing/infrastructure/drizzle-geofence-repository';
import { RouteProfile } from '@panter/contracts';
import { makeEstimateFare } from '../modules/pricing/application/estimate-fare';
import type { PricingFactories } from '../modules/pricing/http/routes';
import {
  createCachedFareCatalog,
  isolateFareCache,
  type FareCache,
} from '../modules/pricing/infrastructure/memory-fare-catalog';
import { buildDb } from './db';
import { buildGetRoute, type RoutingOverrides } from './routing';

/** Repositorios reemplazables en pruebas (en memoria, sin base de datos). */
export interface PricingRepositories {
  rules?: (env: Env) => FareRuleRepository;
  geofences?: (env: Env) => GeofenceRepository;
  changes?: (env: Env) => FareChangeRepository;
}

export const defaultFareRules = (env: Env) => createDrizzleFareRuleRepository(buildDb(env));
export const defaultGeofences = (env: Env) => createDrizzleGeofenceRepository(buildDb(env));
export const defaultFareChanges = (env: Env) => createDrizzleFareChangeRepository(buildDb(env));

/** Raíz de composición de la administración de tarifas (HU-401). */
export function buildPricingAdminFactories(
  overrides: PricingRepositories & { onChange?: OnFareConfigChange } = {},
): PricingAdminFactories {
  const rules = overrides.rules ?? defaultFareRules;
  const geofences = overrides.geofences ?? defaultGeofences;
  const changes = overrides.changes ?? defaultFareChanges;
  // HU-402: por defecto, cada edición invalida la caché de tarifas de este isolate.
  const onChange = overrides.onChange ?? (() => isolateFareCache.invalidate());
  return {
    getConfig: (env) => makeGetFareConfig({ rules: rules(env), geofences: geofences(env) }),
    updateRule: (env) => makeUpdateFareRule({ rules: rules(env), onChange }),
    updateGeofence: (env) => makeUpdateGeofence({ geofences: geofences(env), onChange }),
    listHistory: (env) => makeListFareHistory({ changes: changes(env) }),
  };
}

/** Adaptadores del estimado reemplazables en pruebas. */
export interface PricingOverrides extends Pick<PricingRepositories, 'rules' | 'geofences'> {
  /** Ruta: por defecto el caso de uso de HU-305 (misma caché KV y cuota de ORS). */
  routing?: RoutingOverrides;
  cache?: FareCache;
  clock?: () => number;
}

/** Raíz de composición del estimado de tarifa (HU-402). */
export function buildPricingFactories(overrides: PricingOverrides = {}): PricingFactories {
  const rules = overrides.rules ?? defaultFareRules;
  const geofences = overrides.geofences ?? defaultGeofences;
  return {
    estimate: (env) => {
      const getRoute = buildGetRoute(env, overrides.routing);
      return makeEstimateFare({
        catalog: createCachedFareCatalog({
          rules: rules(env),
          geofences: geofences(env),
          cache: overrides.cache,
          now: overrides.clock,
        }),
        route: ({ userId, origin, destination }) =>
          getRoute({ userId, origin, destination, profile: RouteProfile.CAR }),
        clock: overrides.clock,
      });
    },
  };
}
