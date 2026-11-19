import {
  FareConfigResponseSchema,
  FareHistoryResponseSchema,
  FareRoutes,
  type FareConfigResponse,
  type FareRuleUpdateBody,
  type VehicleType,
} from '@panter/contracts';
import { z } from 'zod';
import { createHttpClient } from '@/shared/api/http-client';
import type { GeofenceUpdateBody } from '../lib/fares';

export interface FaresApiConfig {
  /** URL base de panter-api. */
  apiUrl: string;
  /** Inyectable para pruebas; por defecto el `fetch` global. */
  fetch?: typeof fetch;
}

export type FareHistoryResponse = z.infer<typeof FareHistoryResponseSchema>;

export function adminFareRulePath(vehicleType: VehicleType): string {
  return FareRoutes.ADMIN_RULE.replace(':vehicleType', vehicleType);
}

export function adminGeofencePath(id: string): string {
  return FareRoutes.ADMIN_GEOFENCE.replace(':id', encodeURIComponent(id));
}

/**
 * Llamadas de servidor a servidor a la configuración de tarifas (HU-403), con el access token
 * de la cookie como Bearer. Las respuestas de los PUT no se interpretan: la página se vuelve a
 * cargar (router.refresh) para traer la configuración y el historial nuevos.
 */
export interface FaresApi {
  config(accessToken: string): Promise<FareConfigResponse>;
  history(accessToken: string, cursor?: string): Promise<FareHistoryResponse>;
  updateRule(
    accessToken: string,
    vehicleType: VehicleType,
    body: FareRuleUpdateBody,
  ): Promise<unknown>;
  updateGeofence(accessToken: string, id: string, body: GeofenceUpdateBody): Promise<unknown>;
}

export function createFaresApi(config: FaresApiConfig): FaresApi {
  const client = (accessToken: string) =>
    createHttpClient({
      baseUrl: config.apiUrl,
      fetch: config.fetch,
      getAccessToken: () => accessToken,
    });
  return {
    config: (accessToken) =>
      client(accessToken).get(FareRoutes.ADMIN_CONFIG, { schema: FareConfigResponseSchema }),
    history: (accessToken, cursor) =>
      client(accessToken).get(FareRoutes.ADMIN_HISTORY, {
        schema: FareHistoryResponseSchema,
        query: { cursor },
      }),
    updateRule: (accessToken, vehicleType, body) =>
      client(accessToken).put(adminFareRulePath(vehicleType), { schema: z.unknown(), body }),
    updateGeofence: (accessToken, id, body) =>
      client(accessToken).put(adminGeofencePath(id), { schema: z.unknown(), body }),
  };
}
