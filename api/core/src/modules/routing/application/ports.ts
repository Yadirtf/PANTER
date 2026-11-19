import type { LatLng, RouteProfile } from '@panter/contracts';
import type { RateWindow, Route } from '../domain/route';

export type RouteProfileName = (typeof RouteProfile)[keyof typeof RouteProfile];

export interface RouteRequest {
  origin: LatLng;
  destination: LatLng;
  profile: RouteProfileName;
}

/**
 * Motivo de fallo del proveedor:
 * - `not_found`: no hay ruta entre los puntos (o no hay una vía cerca de alguno);
 * - `unavailable`: error de red, timeout, 5xx, cuota agotada o clave rechazada;
 * - `not_configured`: falta la clave (no se llegó a llamar al proveedor).
 */
export type RouteProviderFailure = 'not_found' | 'unavailable' | 'not_configured';

export class RouteProviderError extends Error {
  readonly reason: RouteProviderFailure;
  /** Estado HTTP del proveedor, si respondió. */
  readonly status?: number;
  /** Segundos de espera que indicó el proveedor (cabecera Retry-After), si los indicó. */
  readonly retryAfterSeconds?: number;

  constructor(
    reason: RouteProviderFailure,
    message: string,
    options: { status?: number; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'RouteProviderError';
    this.reason = reason;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/** Puerto: proveedor de rutas (OpenRouteService). Lanza `RouteProviderError`. */
export interface RouteProvider {
  route(request: RouteRequest): Promise<Route>;
}

/** Puerto: caché de rutas (KV, 10 minutos). */
export interface RouteCache {
  get(key: string): Promise<Route | null>;
  put(key: string, route: Route): Promise<void>;
}

/** Puerto: contador diario de consultas reales al proveedor (KV, clave por fecha de Colombia). */
export interface ProviderUsageCounter {
  /** Suma una consulta al día `date` (YYYY-MM-DD) y devuelve el total del día. */
  increment(date: string): Promise<number>;
}

/** Puerto: ventana del límite por usuario (KV). */
export interface RouteRateStore {
  get(userId: string): Promise<RateWindow | null>;
  put(userId: string, window: RateWindow): Promise<void>;
}

export interface ProviderRequestLog {
  date: string;
  count: number;
  quota: number;
  outcome: 'ok' | RouteProviderFailure;
  status?: number;
  durationMs: number;
}

/** Puerto: logs estructurados del módulo. */
export interface RoutingLog {
  providerRequest(entry: ProviderRequestLog): void;
  quotaWarning(entry: { date: string; count: number; quota: number }): void;
  notConfigured(message: string): void;
  storageError(operation: string, error: unknown): void;
}

export type Clock = () => number;
