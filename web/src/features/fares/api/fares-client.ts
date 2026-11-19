import {
  FareHistoryResponseSchema,
  type FareRuleUpdateBody,
  type VehicleType,
} from '@panter/contracts';
import { z } from 'zod';
import { createHttpClient, type HttpClient } from '@/shared/api/http-client';
import type { GeofenceUpdateBody } from '../lib/fares';

/** Rutas BFF de la edición de tarifas (mismo origen que la web; sin tokens en el navegador). */
export const FaresBffRoutes = {
  HISTORY: '/api/admin/fares/history',
  rule: (vehicleType: VehicleType) => `/api/admin/fares/rules/${vehicleType}`,
  geofence: (id: string) => `/api/admin/fares/geofences/${encodeURIComponent(id)}`,
} as const;

export interface FaresClientConfig {
  /** Origen de la web; por defecto `window.location.origin`. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

function client(config: FaresClientConfig): HttpClient {
  return createHttpClient({
    baseUrl: config.baseUrl ?? window.location.origin,
    fetch: config.fetch,
  });
}

export async function saveRule(
  vehicleType: VehicleType,
  body: FareRuleUpdateBody,
  config: FaresClientConfig = {},
): Promise<void> {
  await client(config).put(FaresBffRoutes.rule(vehicleType), { schema: z.unknown(), body });
}

export async function saveGeofence(
  id: string,
  body: GeofenceUpdateBody,
  config: FaresClientConfig = {},
): Promise<void> {
  await client(config).put(FaresBffRoutes.geofence(id), { schema: z.unknown(), body });
}

export function fetchHistoryPage(cursor: string, config: FaresClientConfig = {}) {
  return client(config).get(FaresBffRoutes.HISTORY, {
    schema: FareHistoryResponseSchema,
    query: { cursor },
  });
}
