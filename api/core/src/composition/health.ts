import type { Env } from '../env';
import { makeGetHealth, type GetHealth } from '../modules/health/application/get-health';
import { createRealtimeHealthClient } from '../modules/health/infrastructure/realtime-health-client';

export const SERVICE_NAME = 'panter-api';

/** Raíz de composición del módulo health: arma el caso de uso a partir de `env`. */
export function buildGetHealth(env: Env): GetHealth {
  return makeGetHealth({
    info: {
      service: SERVICE_NAME,
      version: env.APP_VERSION || 'dev',
      commit: env.GIT_COMMIT || 'dev',
      environment: env.ENVIRONMENT || 'development',
    },
    realtime: createRealtimeHealthClient(env.REALTIME),
  });
}
