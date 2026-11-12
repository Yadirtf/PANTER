/** Estado del Worker panter-realtime visto desde api-core. */
export type RealtimeStatus =
  ({ status: 'ok' } & Record<string, unknown>) | { status: 'unreachable' };

/** Puerto: consulta el healthcheck de realtime. Nunca lanza; si falla devuelve `unreachable`. */
export interface RealtimeHealthPort {
  check(): Promise<RealtimeStatus>;
}

export interface ServiceInfo {
  service: string;
  version: string;
  commit: string;
  environment: string;
}

export interface HealthReport extends ServiceInfo {
  realtime: RealtimeStatus;
}

export interface GetHealthDeps {
  info: ServiceInfo;
  realtime: RealtimeHealthPort;
}

export type GetHealth = () => Promise<HealthReport>;

/** Caso de uso: arma el reporte de salud del servicio y de sus dependencias. */
export function makeGetHealth({ info, realtime }: GetHealthDeps): GetHealth {
  return async () => {
    let status: RealtimeStatus;
    try {
      status = await realtime.check();
    } catch {
      status = { status: 'unreachable' };
    }
    return { ...info, realtime: status };
  };
}
