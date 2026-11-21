import type { LatLng, RouteProfile } from '@panter/contracts';
import type { ProviderRoute, RateWindow, Route } from '../domain/route';

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

/**
 * Puerto: proveedor de rutas (OpenRouteService). Pide la ruta más corta con alternativas en una
 * sola consulta y devuelve la de menor distancia (HU-307). Lanza `RouteProviderError`.
 */
export interface RouteProvider {
  route(request: RouteRequest): Promise<ProviderRoute>;
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

/**
 * Ruta inusual (HU-307): más de 2,5 veces la línea recta y al menos 1 km. Origen y destino van
 * redondeados a 4 decimales: sirven para ubicar la vía faltante en OpenStreetMap (HU-1102) sin
 * registrar la ubicación exacta de nadie.
 */
export interface UnusualRouteLog {
  profile: RouteProfileName;
  origin: LatLng;
  destination: LatLng;
  distanceMeters: number;
  straightMeters: number;
  detourRatio: number;
  originSnapMeters: number;
  destinationSnapMeters: number;
  alternatives: number;
}

/** Puerto: logs estructurados del módulo. */
export interface RoutingLog {
  /** HU-307: ruta anómala, para mapear después la vía en OSM. */
  unusualRoute(entry: UnusualRouteLog): void;
  providerRequest(entry: ProviderRequestLog): void;
  quotaWarning(entry: { date: string; count: number; quota: number }): void;
  notConfigured(message: string): void;
  storageError(operation: string, error: unknown): void;
}

export type Clock = () => number;
