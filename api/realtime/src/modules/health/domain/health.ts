export const SERVICE_NAME = 'panter-realtime';

export interface HealthStatus {
  service: typeof SERVICE_NAME;
  version: string;
  commit: string;
}

/** Contrato de GET /health, consumido por api-core vía Service Binding. */
export function buildHealth(version?: string, commit?: string): HealthStatus {
  return {
    service: SERVICE_NAME,
    version: version || 'dev',
    commit: commit || 'dev',
  };
}
