import { decodePolyline, haversineMeters, ROUTE_ALTERNATIVES } from '@panter/contracts';
import { RouteProviderError, type RouteProvider, type RouteRequest } from '../application/ports';
import { shortestOf, type ProviderRoute } from '../domain/route';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const ORS_BASE_URL = 'https://api.openrouteservice.org';
/** Timeout corto: el usuario espera la ruta en la pantalla y ORS suele responder en < 1 s. */
export const ORS_TIMEOUT_MS = 5_000;

/**
 * Códigos de error de ORS (RoutingErrorCodes): 2009 = no hay ruta entre los puntos,
 * 2010 = no hay una vía a menos de 350 m de una coordenada.
 */
const ORS_NO_ROUTE_CODES = new Set([2009, 2010]);

/**
 * Parámetros de rutas alternativas de ORS v2 (`alternative_routes`, HU-307):
 * - `weight_factor`: las alternativas pueden costar hasta 1,6 veces la óptima (ORS usa 1,4 por
 *   defecto; 1,6 deja pasar desvíos cortos que con `preference: shortest` suelen ser útiles);
 * - `share_factor`: comparten como máximo el 60 % del trayecto con la óptima (el defecto de ORS).
 */
export const ORS_ALTERNATIVE_WEIGHT_FACTOR = 1.6;
export const ORS_ALTERNATIVE_SHARE_FACTOR = 0.6;
/**
 * ORS rechaza `alternative_routes` (error 2004, límite del servidor) si la distancia aproximada
 * entre los puntos supera `maximum_distance_alternative_routes`: 100 km en la API pública. La
 * diagonal de SERVICE_AREA mide unos 130 km, así que por encima de 95 km en línea recta se pide
 * una sola ruta (sigue siendo la más corta) en vez de arriesgar un error.
 */
export const ORS_ALTERNATIVES_MAX_STRAIGHT_METERS = 95_000;

export interface OrsConfig {
  /** Secreto ORS_API_KEY. Vacío o ausente → `not_configured`, sin llamar a ORS. */
  apiKey: string | undefined;
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * Cuerpo de POST /v2/directions/{profile}. Todos son parámetros documentados de ORS v2
 * (RouteRequest): un nombre desconocido haría fallar la consulta con el error 2012.
 * `alternative_routes` solo admite 2 coordenadas (si no, error 2011) y `target_count` ≤ 3
 * (`maximum_alternative_routes` de la API pública; si no, error 2003).
 */
export function orsDirectionsBody({ origin, destination }: RouteRequest) {
  const withAlternatives =
    haversineMeters(origin, destination) <= ORS_ALTERNATIVES_MAX_STRAIGHT_METERS;
  return {
    coordinates: [
      [origin.lng, origin.lat],
      [destination.lng, destination.lat],
    ],
    preference: 'shortest',
    ...(withAlternatives
      ? {
          alternative_routes: {
            target_count: ROUTE_ALTERNATIVES,
            weight_factor: ORS_ALTERNATIVE_WEIGHT_FACTOR,
            share_factor: ORS_ALTERNATIVE_SHARE_FACTOR,
          },
        }
      : {}),
    instructions: false,
    units: 'm',
  };
}

/** Respuesta JSON de POST /v2/directions/{profile} (solo los campos que se usan). */
interface OrsDirectionsResponse {
  bbox?: number[];
  routes?: {
    /** ORS omite `distance` y `duration` cuando valen 0 (origen = destino). */
    summary?: { distance?: number; duration?: number };
    bbox?: number[];
    /** Polilínea codificada (precisión 5): formato por defecto de la respuesta JSON de v2. */
    geometry?: string;
  }[];
}

/** Retry-After en segundos o como fecha HTTP. */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Math.max(1, Number(trimmed));
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(1, Math.ceil((at - nowMs) / 1000));
}

function bboxOf(polyline: string, fromOrs: number[] | undefined): ProviderRoute['bbox'] {
  if (fromOrs && fromOrs.length === 4 && fromOrs.every(Number.isFinite)) {
    return [fromOrs[0]!, fromOrs[1]!, fromOrs[2]!, fromOrs[3]!];
  }
  const points = decodePolyline(polyline);
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function errorCode(body: string): number | undefined {
  try {
    const code = (JSON.parse(body) as { error?: { code?: unknown } }).error?.code;
    return typeof code === 'number' ? code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Adaptador de OpenRouteService (plan Standard gratuito, §6.2): `POST /v2/directions/{perfil}`
 * con la clave en `Authorization`. La respuesta JSON de v2 trae la geometría como polilínea
 * codificada (lo que en v1 era `geometry_format=encodedpolyline`; en v2 ese parámetro ya no
 * existe y ORS lo rechazaría con el error 2012 "parámetro desconocido").
 *
 * HU-307: pide `preference: shortest` y hasta `ROUTE_ALTERNATIVES` alternativas en la misma
 * consulta (una sola unidad de cuota) y devuelve la de menor distancia. ORS solo calcula el
 * bbox general de la respuesta; el de la ruta elegida se toma de la ruta o de su polilínea.
 *
 * - 200 → ruta; 404/400 con código 2009 o 2010 → `not_found`;
 * - 401/403 (clave inválida o cuota), 429 (límite por minuto o cuota diaria), 5xx, red o
 *   timeout → `unavailable`, con el Retry-After de ORS si viene.
 * Nunca incluye la clave ni el cuerpo de la respuesta en los mensajes de error.
 */
export function createOrsRouteProvider(config: OrsConfig): RouteProvider {
  const fetchFn: FetchLike = config.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = (config.baseUrl ?? ORS_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? ORS_TIMEOUT_MS;
  const now = config.now ?? Date.now;

  return {
    async route(request: RouteRequest): Promise<ProviderRoute> {
      const apiKey = config.apiKey?.trim();
      if (!apiKey) {
        throw new RouteProviderError(
          'not_configured',
          'Falta configurar el secreto ORS_API_KEY del Worker panter-api (Docs/GUIA-DESPLIEGUE.md → "M2 · Rutas con OpenRouteService").',
        );
      }
      let res: Response;
      try {
        res = await fetchFn(`${baseUrl}/v2/directions/${request.profile}`, {
          method: 'POST',
          headers: {
            authorization: apiKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(orsDirectionsBody(request)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        throw new RouteProviderError('unavailable', 'ORS: error de red o timeout', { cause });
      }
      const text = await res.text().catch(() => '');

      if (!res.ok) {
        const code = errorCode(text);
        if (code !== undefined && ORS_NO_ROUTE_CODES.has(code)) {
          throw new RouteProviderError('not_found', `ORS no encontró ruta (código ${code})`, {
            status: res.status,
          });
        }
        throw new RouteProviderError(
          'unavailable',
          `ORS respondió ${res.status}${code === undefined ? '' : ` (código ${code})`}`,
          {
            status: res.status,
            retryAfterSeconds: parseRetryAfter(res.headers.get('retry-after'), now()),
          },
        );
      }

      let body: OrsDirectionsResponse;
      try {
        body = JSON.parse(text) as OrsDirectionsResponse;
      } catch (cause) {
        throw new RouteProviderError('unavailable', 'ORS devolvió un JSON inválido', {
          status: res.status,
          cause,
        });
      }
      const candidates = (body.routes ?? []).flatMap((r) =>
        typeof r.geometry === 'string'
          ? [{ ...r, geometry: r.geometry, distanceMeters: r.summary?.distance ?? 0 }]
          : [],
      );
      const best = shortestOf(candidates);
      if (!best) {
        throw new RouteProviderError('not_found', 'ORS respondió sin rutas', { status: 200 });
      }
      return {
        distanceMeters: best.distanceMeters,
        durationSeconds: best.summary?.duration ?? 0,
        polyline: best.geometry,
        // El bbox general solo sirve si ORS devolvió una sola ruta (con alternativas es la unión).
        bbox: bboxOf(best.geometry, best.bbox ?? (candidates.length === 1 ? body.bbox : undefined)),
        alternatives: candidates.length,
      };
    },
  };
}
