import { z } from 'zod';
import { apiClient, type HttpClient } from '@/shared/api';

/**
 * Respuesta de `GET /health` de panter-api.
 * TODO: reemplazar por el esquema de @panter/contracts cuando HU-002 lo publique.
 */
export const HealthResponseSchema = z.object({
  status: z.string(),
  service: z.string().optional(),
  version: z.string().optional(),
  timestamp: z.string().optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function getHealth(
  options: { signal?: AbortSignal } = {},
  client: HttpClient = apiClient,
): Promise<HealthResponse> {
  return client.get('/health', { schema: HealthResponseSchema, signal: options.signal });
}
