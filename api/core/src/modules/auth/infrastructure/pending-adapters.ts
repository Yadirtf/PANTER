import type { ActiveTripChecker, DriverAvailability } from '../application/ports';

/**
 * Adaptadores provisionales de M1 (Docs/BACKLOG.md, notas de HU-104). Todavía no existen los
 * viajes (HU-601/HU-602) ni driver_profiles (HU-201): se reemplazan en la raíz de composición
 * (composition/auth.ts) cuando esos módulos estén listos.
 */

/** Nadie tiene viajes en curso mientras no existan los viajes. */
export const noActiveTrips: ActiveTripChecker = {
  hasActiveTrip: async () => false,
};

/** No hay disponibilidad que apagar mientras no exista driver_profiles. */
export const noopDriverAvailability: DriverAvailability = {
  setUnavailable: async () => {},
};
