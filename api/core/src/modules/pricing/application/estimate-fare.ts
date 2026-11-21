import {
  FARE_ESTIMATE_TTL_SECONDS,
  type FareEstimateBody,
  type FareEstimateResponse,
} from '@panter/contracts';
import { AppError } from '../../../shared/errors/app-error';
import { calculateFare } from '../domain/fare-calculator';
import { PricingErrors } from './errors';
import type { FareCatalog, RouteSource } from './ports';

/** Tolerancia de `departAt` en el pasado (relojes de teléfono desfasados). */
export const DEPART_AT_PAST_TOLERANCE_MS = 5 * 60 * 1000;
/** Reservas: hasta 7 días hacia adelante. */
export const DEPART_AT_MAX_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;

/** POST /fares/estimate */
export type EstimateFare = (
  userId: string,
  body: FareEstimateBody,
) => Promise<FareEstimateResponse>;

/**
 * Estimado de tarifa (HU-402):
 * 1. `departAt` (opcional) entre 5 min atrás y 7 días adelante; si está en el pasado se usa
 *    la hora actual, así no se puede esquivar el recargo nocturno con una hora vieja.
 * 2. Regla del vehículo (caché del isolate); inexistente o inactiva → 404 `FARE_RULE_NOT_FOUND`
 *    antes de gastar cuota de rutas.
 * 3. Ruta con el caso de uso de HU-305 (misma caché KV: no consume cuota extra) y geocercas que
 *    cubren el origen o el destino. La ruta trae su calidad (HU-307: ajuste a la vía y ruta
 *    inusual) para que la app avise igual que con GET /routes.
 * 4. Cálculo puro (`calculateFare`) y vigencia `validUntil` = ahora + 10 min.
 */
export function makeEstimateFare(deps: {
  catalog: FareCatalog;
  route: RouteSource;
  clock?: () => number;
}): EstimateFare {
  const now = deps.clock ?? Date.now;
  return async (userId, { origin, destination, vehicleType, departAt }) => {
    const current = now();
    let departure = current;
    if (departAt) {
      const at = Date.parse(departAt);
      if (at < current - DEPART_AT_PAST_TOLERANCE_MS || at > current + DEPART_AT_MAX_AHEAD_MS) {
        throw AppError.validation(
          'La hora de salida debe estar entre ahora y los próximos 7 días.',
          [{ path: 'departAt', code: 'out_of_range', message: 'Hora de salida fuera de rango' }],
        );
      }
      departure = Math.max(at, current);
    }

    const rule = await deps.catalog.rule(vehicleType);
    if (!rule || !rule.active) throw PricingErrors.fareRuleNotFound();

    const route = await deps.route({ userId, origin, destination });
    const zones = await deps.catalog.covering({ origin, destination, vehicleType });
    const quote = calculateFare({
      rule,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      departAt: departure,
      zones,
    });

    return {
      vehicleType,
      currency: 'COP',
      total: quote.total,
      breakdown: quote.breakdown,
      route: {
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        polyline: route.polyline,
        quality: route.quality,
      },
      isNight: quote.isNight,
      validUntil: new Date(current + FARE_ESTIMATE_TTL_SECONDS * 1000).toISOString(),
    };
  };
}
