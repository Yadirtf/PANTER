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
import { buildDb } from './db';

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
  const { onChange } = overrides;
  return {
    getConfig: (env) => makeGetFareConfig({ rules: rules(env), geofences: geofences(env) }),
    updateRule: (env) => makeUpdateFareRule({ rules: rules(env), onChange }),
    updateGeofence: (env) => makeUpdateGeofence({ geofences: geofences(env), onChange }),
    listHistory: (env) => makeListFareHistory({ changes: changes(env) }),
  };
}
