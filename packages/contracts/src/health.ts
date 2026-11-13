import { z } from 'zod';

/**
 * Estado de panter-realtime tal como lo informa panter-api (Service Binding).
 * `ok` incluye los datos de su propio `/health`; `unreachable` si no respondió.
 */
export const RealtimeHealthSchema = z.union([
  z.object({
    status: z.literal('ok'),
    service: z.string().optional(),
    version: z.string().optional(),
    commit: z.string().optional(),
  }),
  z.object({ status: z.literal('unreachable') }),
]);
export type RealtimeHealth = z.infer<typeof RealtimeHealthSchema>;

/**
 * Contrato de `GET /health` de panter-api. Lo usan la web y la app para validar la
 * respuesta, y api-core lo verifica en sus pruebas para que no se desvíen.
 * Campos adicionales se ignoran: agregar campos a la API no rompe a los clientes.
 */
export const HealthResponseSchema = z.object({
  service: z.string(),
  version: z.string(),
  commit: z.string(),
  environment: z.string(),
  realtime: RealtimeHealthSchema,
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
