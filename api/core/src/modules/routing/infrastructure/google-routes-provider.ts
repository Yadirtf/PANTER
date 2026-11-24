import { decodePolyline } from '@panter/contracts';
import { RouteProviderError, type RouteProvider, type RouteRequest } from '../application/ports';
import { shortestOf, type ProviderRoute } from '../domain/route';
import { parseRetryAfter, type FetchLike } from './openrouteservice-route-provider';

export const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
export const GOOGLE_ROUTES_TIMEOUT_MS = 5_000;

/**
 * Campos pedidos (cabecera X-Goog-FieldMask, obligatoria). Solo los que se usan: pedir de más no
 * cambia el precio, pero sí el tamaño de la respuesta.
 */
export const GOOGLE_ROUTES_FIELD_MASK = [
  'routes.distanceMeters',
  'routes.duration',
  'routes.polyline.encodedPolyline',
  'routes.viewport',
].join(',');

export interface GoogleRoutesConfig {
  /** Secreto GOOGLE_ROUTES_API_KEY. Vacío o ausente → `not_configured`, sin llamar a Google. */
  apiKey: string | undefined;
  fetch?: FetchLike;
  url?: string;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * Cuerpo de POST directions/v2:computeRoutes. Se mantiene en el SKU "Compute Routes Essentials"
 * (el más barato): `TRAFFIC_UNAWARE`, sin paradas intermedias ni modificadores de ubicación, y
 * `DRIVE` (`TWO_WHEELER` para el mototaxi se cobraría como Enterprise). Las alternativas no
 * cambian el SKU. La polilínea viene en el formato estándar de precisión 5, igual que con ORS.
 */
export function googleRoutesBody({ origin, destination }: RouteRequest) {
  const waypoint = (p: { lat: number; lng: number }) => ({
    location: { latLng: { latitude: p.lat, longitude: p.lng } },
  });
  return {
    origin: waypoint(origin),
    destination: waypoint(destination),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE',
    computeAlternativeRoutes: true,
    polylineQuality: 'HIGH_QUALITY',
    polylineEncoding: 'ENCODED_POLYLINE',
    languageCode: 'es-419',
    regionCode: 'co',
    units: 'METRIC',
  };
}

interface GoogleLatLng {
  latitude?: number;
  longitude?: number;
}

/** Respuesta de computeRoutes (solo los campos de GOOGLE_ROUTES_FIELD_MASK). */
interface GoogleRoutesResponse {
  routes?: {
    /** Google omite los campos que valen 0 (origen = destino). */
    distanceMeters?: number;
    /** Duración como texto, p. ej. "754s". */
    duration?: string;
    polyline?: { encodedPolyline?: string };
    viewport?: { low?: GoogleLatLng; high?: GoogleLatLng };
  }[];
}

/** "754s" o "754.5s" → segundos. */
export function parseGoogleDuration(value: string | undefined): number {
  const match = value ? /^(\d+(?:\.\d+)?)s$/.exec(value.trim()) : null;
  return match ? Number(match[1]) : 0;
}

function bboxOf(
  polyline: string,
  viewport: { low?: GoogleLatLng; high?: GoogleLatLng } | undefined,
): ProviderRoute['bbox'] {
  const { low, high } = viewport ?? {};
  const box = [low?.longitude, low?.latitude, high?.longitude, high?.latitude];
  if (box.every((n): n is number => typeof n === 'number' && Number.isFinite(n))) {
    return [box[0]!, box[1]!, box[2]!, box[3]!];
  }
  const points = decodePolyline(polyline);
  if (points.length === 0) return [0, 0, 0, 0];
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/**
 * Adaptador de Google Routes API (`computeRoutes`), alternativa a OpenRouteService: usa los datos
 * de Google, que en Villagarzón no tienen el error de sentido único de OSM en la Carrera 7.
 * Igual que con ORS (HU-307), pide alternativas en una sola consulta y devuelve la más corta.
 *
 * Condiciones de Google: las rutas solo se pueden mostrar sobre un mapa de Google (la app debe
 * usar Google Maps, no MapLibre) y las coordenadas se pueden guardar hasta 30 días (la caché KV
 * es de 10 minutos).
 *
 * - 200 con rutas → ruta; 200 sin rutas (`{}`) → `not_found`;
 * - 400 (punto inválido), 401/403 (clave o API no habilitada), 429 (cuota), 5xx, red o timeout →
 *   `unavailable`.
 * Nunca incluye la clave ni el cuerpo de la respuesta en los mensajes de error.
 */
export function createGoogleRoutesProvider(config: GoogleRoutesConfig): RouteProvider {
  const fetchFn: FetchLike = config.fetch ?? globalThis.fetch.bind(globalThis);
  const url = config.url ?? GOOGLE_ROUTES_URL;
  const timeoutMs = config.timeoutMs ?? GOOGLE_ROUTES_TIMEOUT_MS;
  const now = config.now ?? Date.now;

  return {
    async route(request: RouteRequest): Promise<ProviderRoute> {
      const apiKey = config.apiKey?.trim();
      if (!apiKey) {
        throw new RouteProviderError(
          'not_configured',
          'Falta configurar el secreto GOOGLE_ROUTES_API_KEY del Worker panter-api (Docs/GUIA-DESPLIEGUE.md → "Rutas con Google Routes API").',
        );
      }
      let res: Response;
      try {
        res = await fetchFn(url, {
          method: 'POST',
          headers: {
            'x-goog-api-key': apiKey,
            'x-goog-fieldmask': GOOGLE_ROUTES_FIELD_MASK,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(googleRoutesBody(request)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        throw new RouteProviderError('unavailable', 'Google Routes: error de red o timeout', {
          cause,
        });
      }
      const text = await res.text().catch(() => '');

      if (!res.ok) {
        throw new RouteProviderError('unavailable', `Google Routes respondió ${res.status}`, {
          status: res.status,
          retryAfterSeconds: parseRetryAfter(res.headers.get('retry-after'), now()),
        });
      }

      let body: GoogleRoutesResponse;
      try {
        body = JSON.parse(text || '{}') as GoogleRoutesResponse;
      } catch (cause) {
        throw new RouteProviderError('unavailable', 'Google Routes devolvió un JSON inválido', {
          status: res.status,
          cause,
        });
      }
      const candidates = (body.routes ?? []).flatMap((r) => {
        const geometry = r.polyline?.encodedPolyline;
        return typeof geometry === 'string'
          ? [{ ...r, geometry, distanceMeters: r.distanceMeters ?? 0 }]
          : [];
      });
      const best = shortestOf(candidates);
      if (!best) {
        throw new RouteProviderError('not_found', 'Google Routes no encontró ruta', {
          status: 200,
        });
      }
      return {
        distanceMeters: best.distanceMeters,
        durationSeconds: parseGoogleDuration(best.duration),
        polyline: best.geometry,
        bbox: bboxOf(best.geometry, best.viewport),
        alternatives: candidates.length,
      };
    },
  };
}
