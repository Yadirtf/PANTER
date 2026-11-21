import {
  decodePolyline,
  haversineMeters,
  isInServiceArea,
  OPERATION_UTC_OFFSET_MINUTES,
  ORS_DAILY_QUOTA,
  ROUTE_CACHE_DECIMALS,
  ROUTE_CACHE_VERSION,
  routeQuality,
  type LatLng,
  type RouteQuality,
} from '@panter/contracts';

/** Ruta elegida por el proveedor entre las alternativas que devolvió (HU-307). */
export interface ProviderRoute {
  distanceMeters: number;
  durationSeconds: number;
  /** Polilínea codificada (precisión 5). */
  polyline: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  /** Rutas que devolvió el proveedor en la consulta (la elegida es la de menor distancia). */
  alternatives: number;
}

/** Ruta calculada (sin el indicador `cached`, que depende de la consulta). */
export interface Route {
  distanceMeters: number;
  durationSeconds: number;
  /** Polilínea codificada (precisión 5). */
  polyline: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  /** Ajuste a la vía y ruta inusual (HU-307). */
  quality: RouteQuality;
}

/** De las rutas candidatas, la de menor distancia (HU-307: siempre el camino más corto). */
export function shortestOf<T extends { distanceMeters: number }>(routes: readonly T[]): T | null {
  let best: T | null = null;
  for (const r of routes) if (!best || r.distanceMeters < best.distanceMeters) best = r;
  return best;
}

function vertices(polyline: string): LatLng[] {
  try {
    return decodePolyline(polyline);
  } catch {
    return [];
  }
}

/**
 * Calidad de la ruta (HU-307):
 * - ajuste a la vía: haversine entre el punto pedido y el primer (o último) vértice de la
 *   polilínea, que es donde el proveedor "pegó" el punto a la vía más cercana;
 * - línea recta: haversine entre origen y destino; el factor y la marca de ruta inusual los
 *   decide `routeQuality` de contracts (la misma función que usan los clientes).
 * Una polilínea vacía o ilegible no tiene vértices: el ajuste se informa como 0.
 */
export function assessRoute(origin: LatLng, destination: LatLng, route: ProviderRoute): Route {
  const points = vertices(route.polyline);
  const first = points[0];
  const last = points[points.length - 1];
  const { alternatives, ...rest } = route;
  return {
    ...rest,
    quality: routeQuality({
      routeMeters: route.distanceMeters,
      straightMeters: haversineMeters(origin, destination),
      originSnapMeters: first ? haversineMeters(origin, first) : 0,
      destinationSnapMeters: last ? haversineMeters(destination, last) : 0,
      alternatives,
    }),
  };
}

/** Coordenada redondeada para el log de rutas inusuales (4 decimales ≈ 11 m, como la caché). */
export function roundForLog(point: LatLng, decimals: number = ROUTE_CACHE_DECIMALS): LatLng {
  const f = 10 ** decimals;
  return { lat: Math.round(point.lat * f) / f || 0, lng: Math.round(point.lng * f) / f || 0 };
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
 * Clave de caché de una ruta: versión del criterio (`ROUTE_CACHE_VERSION`: v2 = ruta más corta
 * con alternativas, HU-307), perfil y par de coordenadas redondeadas a `ROUTE_CACHE_DECIMALS`
 * (4 decimales ≈ 11 m). El sentido importa: A → B no es B → A (vías de un solo sentido).
 */
export function routeCacheKey(
  profile: string,
  origin: LatLng,
  destination: LatLng,
  decimals: number = ROUTE_CACHE_DECIMALS,
): string {
  const p = (x: LatLng) => `${rounded(x.lat, decimals)},${rounded(x.lng, decimals)}`;
  return `route:${ROUTE_CACHE_VERSION}:${profile}:${decimals}:${p(origin)}:${p(destination)}`;
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
