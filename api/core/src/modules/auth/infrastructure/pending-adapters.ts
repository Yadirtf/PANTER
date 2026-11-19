import type { ActiveTripChecker } from '../application/ports';

/**
 * Adaptador provisional de M1 (Docs/BACKLOG.md, notas de HU-104). Todavía no existen los viajes
 * (HU-601/HU-602): se reemplaza en la raíz de composición (composition/auth.ts) cuando estén.
 * La disponibilidad del conductor ya es real desde HU-201 (módulo drivers).
 */

/** Nadie tiene viajes en curso mientras no existan los viajes. */
export const noActiveTrips: ActiveTripChecker = {
  hasActiveTrip: async () => false,
};
