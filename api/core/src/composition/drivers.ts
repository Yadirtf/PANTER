import type { Env } from '../env';
import type { DriverAvailability, DriverModeEligibility } from '../modules/auth/application/ports';
import { makeApplyAsDriver, makeGetMyDriverProfile } from '../modules/drivers/application/apply';
import type { DriverRepository } from '../modules/drivers/application/ports';
import type { DriverFactories } from '../modules/drivers/http/routes';
import { createDrizzleDriverRepository } from '../modules/drivers/infrastructure/drizzle-driver-repository';
import { buildDb } from './db';

/**
 * Adaptadores del módulo drivers para los puertos de auth (HU-104 → HU-201): disponibilidad
 * OFFLINE al pasar a pasajero y verificación APPROVED para el modo conductor. Perezosos: la
 * base de datos se abre solo si se consultan (p. ej. POST /auth/refresh de un pasajero no la
 * necesita).
 */
export const defaultDriverAvailability = (env: Env): DriverAvailability => ({
  setUnavailable: async (userId) =>
    createDrizzleDriverRepository(buildDb(env)).setUnavailable(userId),
});

export const defaultDriverEligibility = (env: Env): DriverModeEligibility => ({
  canUseDriverMode: async (userId) =>
    createDrizzleDriverRepository(buildDb(env)).canUseDriverMode(userId),
});

export interface DriverOverrides {
  repo?: (env: Env) => DriverRepository;
}

/** Raíz de composición del módulo drivers (E2). Los adaptadores se reemplazan en las pruebas. */
export function buildDriverFactories(overrides: DriverOverrides = {}): DriverFactories {
  const repo = overrides.repo ?? ((env: Env) => createDrizzleDriverRepository(buildDb(env)));
  return {
    apply: (env) => makeApplyAsDriver({ repo: repo(env) }),
    getMine: (env) => makeGetMyDriverProfile({ repo: repo(env) }),
  };
}
