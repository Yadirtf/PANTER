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

export const RouteResponseSchema = z.object({
  distanceMeters: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  polyline: z.string(),
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
export const ROUTE_CACHE_TTL_SECONDS = 10 * 60;
/** Cuota del plan gratuito de ORS (§6.2). */
export const ORS_DAILY_QUOTA = 2000;
