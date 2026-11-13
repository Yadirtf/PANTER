import { HealthResponseSchema, type HealthResponse } from '@panter/contracts';
import { apiClient, type HttpClient } from '@/shared/api';

export { HealthResponseSchema, type HealthResponse };

/** `GET /health` de panter-api, validado con el contrato compartido de @panter/contracts. */
export function getHealth(
  options: { signal?: AbortSignal } = {},
  client: HttpClient = apiClient,
): Promise<HealthResponse> {
  return client.get('/health', { schema: HealthResponseSchema, signal: options.signal });
}
