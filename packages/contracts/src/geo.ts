import { z } from 'zod';

/**
 * Utilidades geográficas compartidas (HU-306). Funciones puras, sin dependencias: las usan la
 * API (tarifas, geocercas, matching), la app (ETA en el cliente, desvío de ruta) y la web.
 *
 * Convención: `{ lat, lng }` en grados WGS 84. Las polilíneas usan el formato de Google
 * (el mismo que devuelve OpenRouteService con `geometry_format=encodedpolyline`), precisión 5.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** Radio medio de la Tierra (IUGG), en metros. */
export const EARTH_RADIUS_METERS = 6_371_008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Distancia de círculo máximo entre dos puntos, en metros. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longitud total de una línea, en metros. */
export function pathLengthMeters(path: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineMeters(path[i - 1]!, path[i]!);
  return total;
}

/** Decodifica una polilínea codificada (algoritmo de Google). */
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new RangeError('Polilínea truncada');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new RangeError('Polilínea con caracteres inválidos');
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push({ lat: lat / factor, lng: lng / factor });
  }
  return points;
}

/** Codifica una línea como polilínea (algoritmo de Google). */
export function encodePolyline(path: readonly LatLng[], precision = 5): string {
  const factor = 10 ** precision;
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const push = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const p of path) {
    const lat = Math.round(p.lat * factor);
    const lng = Math.round(p.lng * factor);
    push(lat - prevLat);
    push(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

export interface RouteProgress {
  /** Distancia restante sobre la ruta desde el punto proyectado hasta el final, en metros. */
  remainingMeters: number;
  /** Distancia recorrida sobre la ruta hasta el punto proyectado, en metros. */
  traveledMeters: number;
  /** Distancia perpendicular del punto a la ruta (desvío), en metros. */
  offRouteMeters: number;
  /** Índice del segmento [i, i+1] más cercano. */
  segmentIndex: number;
  /** Punto de la ruta más cercano a la posición. */
  snapped: LatLng;
}

/**
 * Proyecta una posición sobre la ruta y calcula lo recorrido, lo restante y el desvío
 * (HU-605: ETA en el cliente; §6.2: recálculo si el desvío supera 50 m). Usa una proyección
 * equirectangular local por segmento: el error es despreciable en segmentos urbanos cortos.
 */
export function routeProgress(route: readonly LatLng[], position: LatLng): RouteProgress {
  if (route.length === 0) throw new RangeError('La ruta está vacía');
  if (route.length === 1) {
    const d = haversineMeters(route[0]!, position);
    return {
      remainingMeters: 0,
      traveledMeters: 0,
      offRouteMeters: d,
      segmentIndex: 0,
      snapped: route[0]!,
    };
  }

  const cumulative = [0];
  for (let i = 1; i < route.length; i++) {
    cumulative.push(cumulative[i - 1]! + haversineMeters(route[i - 1]!, route[i]!));
  }
  const total = cumulative[cumulative.length - 1]!;

  let best: RouteProgress | null = null;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    const cosLat = Math.cos(toRad((a.lat + b.lat) / 2));
    // Coordenadas planas locales en metros con origen en `a`.
    const bx = toRad(b.lng - a.lng) * cosLat * EARTH_RADIUS_METERS;
    const by = toRad(b.lat - a.lat) * EARTH_RADIUS_METERS;
    const px = toRad(position.lng - a.lng) * cosLat * EARTH_RADIUS_METERS;
    const py = toRad(position.lat - a.lat) * EARTH_RADIUS_METERS;
    const len2 = bx * bx + by * by;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
    const snapped = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    const off = haversineMeters(snapped, position);
    if (!best || off < best.offRouteMeters) {
      const traveled = cumulative[i]! + haversineMeters(a, snapped);
      best = {
        remainingMeters: Math.max(0, total - traveled),
        traveledMeters: traveled,
        offRouteMeters: off,
        segmentIndex: i,
        snapped,
      };
    }
  }
  return best!;
}

/**
 * Polígono como anillos: el primero es el borde exterior y los siguientes son huecos.
 * Los anillos pueden venir cerrados (último = primero) o abiertos.
 */
export type PolygonRings = readonly (readonly LatLng[])[];

export const PolygonRingsSchema = z
  .array(z.array(LatLngSchema).min(3))
  .min(1)
  .describe('Anillos del polígono: el primero es el exterior, los demás son huecos');

function inRing(point: LatLng, ring: readonly LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.lat > point.lat !== b.lat > point.lat) {
      const x = ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
      if (point.lng < x) inside = !inside;
    }
  }
  return inside;
}

/** Punto en polígono (ray casting) respetando huecos. El borde cuenta de forma indefinida. */
export function pointInPolygon(point: LatLng, polygon: PolygonRings): boolean {
  const [outer, ...holes] = polygon;
  if (!outer || !inRing(point, outer)) return false;
  return !holes.some((hole) => inRing(point, hole));
}

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function inBoundingBox(point: LatLng, box: BoundingBox): boolean {
  return (
    point.lng >= box.west &&
    point.lng <= box.east &&
    point.lat >= box.south &&
    point.lat <= box.north
  );
}
