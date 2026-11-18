import {
  isInServiceArea,
  OPERATION_UTC_OFFSET_MINUTES,
  ORS_DAILY_QUOTA,
  ROUTE_CACHE_DECIMALS,
  type LatLng,
} from '@panter/contracts';

/** Ruta calculada por el proveedor (sin el indicador `cached`, que depende de la consulta). */
export interface Route {
  distanceMeters: number;
  durationSeconds: number;
  /** Polilínea codificada (precisión 5). */
  polyline: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
}

/** Punto de la consulta que quedó fuera del área de servicio, o null si ambos están dentro. */
export function pointOutsideServiceArea(
  origin: LatLng,
  destination: LatLng,
): 'origin' | 'destination' | null {
  if (!isInServiceArea(origin)) return 'origin';
  if (!isInServiceArea(destination)) return 'destination';
  return null;
}

/** Coordenada redondeada a `decimals` como entero (evita "-0.0000" y errores de coma flotante). */
function rounded(value: number, decimals: number): string {
  const n = Math.round(value * 10 ** decimals);
  return String(n === 0 ? 0 : n);
}

/**
 * Clave de caché de una ruta: perfil y par de coordenadas redondeadas a `ROUTE_CACHE_DECIMALS`
 * (4 decimales ≈ 11 m). El sentido importa: A → B no es B → A (vías de un solo sentido).
 */
export function routeCacheKey(
  profile: string,
  origin: LatLng,
  destination: LatLng,
  decimals: number = ROUTE_CACHE_DECIMALS,
): string {
  const p = (x: LatLng) => `${rounded(x.lat, decimals)},${rounded(x.lng, decimals)}`;
  return `route:v1:${profile}:${decimals}:${p(origin)}:${p(destination)}`;
}

/** Fecha de Colombia (UTC−5, sin horario de verano) como `YYYY-MM-DD`, para el contador diario. */
export function colombiaDate(epochMs: number): string {
  return new Date(epochMs + OPERATION_UTC_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** Porcentaje de la cuota diaria de ORS a partir del cual se avisa en los logs. */
export const ORS_QUOTA_WARNING_RATIO = 0.8;

/** true si el contador del día ya llegó al 80 % de la cuota (se avisa desde ahí en adelante). */
export function isQuotaWarning(count: number, quota: number = ORS_DAILY_QUOTA): boolean {
  return count >= Math.ceil(quota * ORS_QUOTA_WARNING_RATIO);
}

/**
 * Límite por usuario de consultas reales a ORS (las que salen de la caché no cuentan). Con la
 * cuota gratuita de 2.000 al día, nadie puede gastar más de 20 por hora (480 al día).
 */
export const ROUTE_USER_LIMIT = 20;
export const ROUTE_USER_WINDOW_SECONDS = 60 * 60;

export interface RateWindow {
  count: number;
  /** Fin de la ventana fija (epoch ms). */
  resetAt: number;
}

export type RateDecision =
  { allowed: true; window: RateWindow } | { allowed: false; retryAfterSeconds: number };

/** Ventana fija: decide si se permite una consulta más y devuelve la ventana actualizada. */
export function consumeRateWindow(
  current: RateWindow | null,
  nowMs: number,
  limit: number = ROUTE_USER_LIMIT,
  windowSeconds: number = ROUTE_USER_WINDOW_SECONDS,
): RateDecision {
  const window =
    current && current.resetAt > nowMs
      ? current
      : { count: 0, resetAt: nowMs + windowSeconds * 1000 };
  if (window.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - nowMs) / 1000)),
    };
  }
  return { allowed: true, window: { count: window.count + 1, resetAt: window.resetAt } };
}
