import { z } from 'zod';
import { LatLngSchema } from './geo';

/**
 * Rutas con OpenRouteService (HU-305, §6.2). La clave vive solo en el Worker; la caché es de
 * 10 minutos por par de coordenadas redondeadas.
 */
export const RouteProfile = { CAR: 'driving-car' } as const;
export const RouteProfileSchema = z.enum(RouteProfile);

/** Coordenadas como texto "lat,lng" en la query. */
const LatLngParam = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, { error: 'Usa el formato lat,lng' })
  .transform((s) => {
    const [lat, lng] = s.split(',').map(Number);
    return { lat: lat!, lng: lng! };
  })
  .pipe(LatLngSchema);

export const RouteQuerySchema = z.object({
  origin: LatLngParam,
  destination: LatLngParam,
  profile: RouteProfileSchema.default(RouteProfile.CAR),
});
export type RouteQuery = z.infer<typeof RouteQuerySchema>;

/**
 * Calidad de la ruta (HU-307). Opcional en el esquema para no romper clientes anteriores; la
 * API siempre lo envía.
 */
export const RouteQualitySchema = z.object({
  /** Distancia en metros entre el origen pedido y donde la ruta empieza (ajuste a la vía). */
  originSnapMeters: z.number().nonnegative(),
  /** Distancia en metros entre el destino pedido y donde la ruta termina. */
  destinationSnapMeters: z.number().nonnegative(),
  /** Distancia de la ruta dividida por la línea recta entre origen y destino. */
  detourRatio: z.number().nonnegative(),
  /** true si la ruta es anómala: detourRatio > DETOUR_RATIO_THRESHOLD y ruta ≥ DETOUR_MIN_METERS. */
  unusual: z.boolean(),
  /** Rutas que devolvió el proveedor; la elegida es la de menor distancia. */
  alternatives: z.number().int().min(1),
});
export type RouteQuality = z.infer<typeof RouteQualitySchema>;

/** Ajuste a la vía a partir del cual la app pide confirmar o mover el pin. */
export const SNAP_WARNING_METERS = 50;
/** Una ruta más de 2,5 veces más larga que la línea recta se considera inusual. */
export const DETOUR_RATIO_THRESHOLD = 2.5;
/** Por debajo de 1 km no se marca como inusual (en distancias cortas el factor se dispara). */
export const DETOUR_MIN_METERS = 1000;
/** Rutas alternativas pedidas en la misma consulta a OpenRouteService (una unidad de cuota). */
export const ROUTE_ALTERNATIVES = 3;

/** Evalúa la calidad de una ruta. Función pura compartida por la API y los clientes. */
export function routeQuality(input: {
  routeMeters: number;
  straightMeters: number;
  originSnapMeters: number;
  destinationSnapMeters: number;
  alternatives: number;
}): RouteQuality {
  const detourRatio =
    input.straightMeters > 0
      ? input.routeMeters / input.straightMeters
      : input.routeMeters > 0
        ? Infinity
        : 1;
  const ratio = Number.isFinite(detourRatio) ? Math.round(detourRatio * 100) / 100 : 999;
  return {
    originSnapMeters: Math.round(input.originSnapMeters),
    destinationSnapMeters: Math.round(input.destinationSnapMeters),
    detourRatio: ratio,
    unusual: input.routeMeters >= DETOUR_MIN_METERS && ratio > DETOUR_RATIO_THRESHOLD,
    alternatives: Math.max(1, input.alternatives),
  };
}

export const RouteResponseSchema = z.object({
  distanceMeters: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  polyline: z.string(),
  quality: RouteQualitySchema.optional(),
  /** [west, south, east, north] */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** true si salió de la caché (no consumió cuota de ORS). */
  cached: z.boolean(),
});
export type RouteResponse = z.infer<typeof RouteResponseSchema>;

export const MapRoutes = {
  ROUTE: '/routes',
  /** Teselas del mapa base (HU-301): GET con soporte de Range. */
  TILES: '/tiles/:file',
} as const;

/** Redondeo para la clave de caché de rutas: 4 decimales ≈ 11 m. */
export const ROUTE_CACHE_DECIMALS = 4;
/** Versión del criterio de rutas en la clave de caché: v2 = ruta más corta con alternativas (HU-307). */
export const ROUTE_CACHE_VERSION = 'v2';
export const ROUTE_CACHE_TTL_SECONDS = 10 * 60;
/** Cuota del plan gratuito de ORS (§6.2). */
export const ORS_DAILY_QUOTA = 2000;
