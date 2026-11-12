import type { RealtimeHealthPort, RealtimeStatus } from '../application/get-health';

export const REALTIME_HEALTH_URL = 'https://realtime/health';
export const REALTIME_HEALTH_TIMEOUT_MS = 1500;

const UNREACHABLE: RealtimeStatus = { status: 'unreachable' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Adaptador del puerto de salud de realtime sobre el Service Binding `REALTIME`.
 * Contrato de realtime: `GET /health → { service: "panter-realtime", version, commit }`.
 * Cualquier fallo (timeout, error de red, estado no 2xx, cuerpo no JSON) es `unreachable`.
 */
export function createRealtimeHealthClient(
  realtime: Pick<Fetcher, 'fetch'>,
  timeoutMs = REALTIME_HEALTH_TIMEOUT_MS,
): RealtimeHealthPort {
  return {
    async check() {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('timeout'));
        }, timeoutMs);
      });
      try {
        const res = await Promise.race([
          realtime.fetch(REALTIME_HEALTH_URL, { signal: controller.signal }),
          timeout,
        ]);
        if (!res.ok) return UNREACHABLE;
        const body: unknown = await Promise.race([res.json(), timeout]);
        if (!isPlainObject(body)) return UNREACHABLE;
        return { ...body, status: 'ok' };
      } catch {
        return UNREACHABLE;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
