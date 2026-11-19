import {
  DriverAvailability,
  haversineMeters,
  type LatLng,
  type VehicleType,
} from '@panter/contracts';
import { VEHICLE_ICON, type RgbaImage, type VehicleIconId } from '@panter/map-style';

/**
 * Capa de marcadores de vehículos (HU-304, para la flota en vivo de HU-504). Funciones puras:
 * construcción del GeoJSON (una sola fuente, actualizada con setData) e interpolación entre
 * posiciones para animar el movimiento.
 */

export type MarkerStatus = DriverAvailability;

export interface MapMarker {
  id: string;
  position: LatLng;
  vehicleType: VehicleType;
  status: MarkerStatus;
  /** Rumbo en grados (0 = norte, sentido horario). Sin rumbo no se dibuja la flecha. */
  heading?: number;
}

export interface MarkerProperties {
  id: string;
  icon: VehicleIconId;
  status: MarkerStatus;
  /** Rumbo normalizado a [0, 360); 0 si no hay. */
  heading: number;
  hasHeading: boolean;
}

export interface MarkerFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: MarkerProperties;
}

export interface MarkerFeatureCollection {
  type: 'FeatureCollection';
  features: MarkerFeature[];
}

/** Color del anillo de estado de cada marcador. */
export const MARKER_STATUS_COLOR: Record<MarkerStatus, string> = {
  [DriverAvailability.AVAILABLE]: '#15803d',
  [DriverAvailability.ON_TRIP]: '#d97706',
  [DriverAvailability.OFFLINE]: '#78716c',
};

export const MARKER_STATUS_LABEL: Record<MarkerStatus, string> = {
  [DriverAvailability.AVAILABLE]: 'Disponible',
  [DriverAvailability.ON_TRIP]: 'En viaje',
  [DriverAvailability.OFFLINE]: 'Desconectado',
};

/** Id de la imagen de la flecha de rumbo que registra la capa. */
export const HEADING_ARROW_ICON = 'panter-heading-arrow';

/** Lleva cualquier ángulo a [0, 360). */
export function normalizeHeading(degrees: number): number {
  const d = ((degrees % 360) + 360) % 360;
  return d === 0 ? 0 : d; // sin −0
}

const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Marcadores como GeoJSON para la fuente de la capa (una entidad por marcador, ids estables). */
export function markersToFeatureCollection(markers: readonly MapMarker[]): MarkerFeatureCollection {
  const seen = new Set<string>();
  const features: MarkerFeature[] = [];
  for (const marker of markers) {
    // Un id repetido haría parpadear el marcador: gana el último.
    if (seen.has(marker.id)) {
      const index = features.findIndex((f) => f.id === marker.id);
      features.splice(index, 1);
    }
    seen.add(marker.id);
    const hasHeading = isFiniteNumber(marker.heading);
    features.push({
      type: 'Feature',
      id: marker.id,
      geometry: { type: 'Point', coordinates: [marker.position.lng, marker.position.lat] },
      properties: {
        id: marker.id,
        icon: VEHICLE_ICON[marker.vehicleType],
        status: marker.status,
        heading: hasHeading ? normalizeHeading(marker.heading!) : 0,
        hasHeading,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

// --- Interpolación ---

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function interpolateLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: lerp(a.lat, b.lat, t), lng: lerp(a.lng, b.lng, t) };
}

/** Rumbo intermedio por el giro más corto (de 350° a 10° pasa por 0°, no por 180°). */
export function interpolateHeading(a: number, b: number, t: number): number {
  const from = normalizeHeading(a);
  let delta = normalizeHeading(b) - from;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return normalizeHeading(from + delta * t);
}

/** Suavizado: arranca y frena sin saltos. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export interface MarkerTransition {
  /** Posición de partida de cada marcador (por id). */
  from: ReadonlyMap<string, MapMarker>;
  /** Destino, en el orden recibido. */
  to: readonly MapMarker[];
}

/**
 * Más allá de esta distancia el marcador salta sin animarse (p. ej. el conductor estuvo sin
 * señal): deslizarlo varios kilómetros sobre el mapa confundiría al despachador.
 */
export const MAX_ANIMATED_JUMP_METERS = 2_000;

/**
 * Prepara la animación desde lo que está dibujado (`current`) hasta la lista nueva. Los
 * marcadores nuevos o con un salto muy largo aparecen directamente en su destino; los que ya no
 * están desaparecen.
 */
export function planTransition(
  current: readonly MapMarker[],
  next: readonly MapMarker[],
  maxJumpMeters = MAX_ANIMATED_JUMP_METERS,
): MarkerTransition {
  const byId = new Map(current.map((m) => [m.id, m]));
  const from = new Map<string, MapMarker>();
  for (const target of next) {
    const start = byId.get(target.id);
    from.set(
      target.id,
      start && haversineMeters(start.position, target.position) <= maxJumpMeters ? start : target,
    );
  }
  return { from, to: next };
}

/** Fotograma de la animación en `t` ∈ [0, 1] (0 = partida, 1 = destino). */
export function frameAt(
  transition: MarkerTransition,
  t: number,
  ease: (t: number) => number = easeInOutCubic,
): MapMarker[] {
  const k = ease(Math.min(1, Math.max(0, t)));
  return transition.to.map((target) => {
    const start = transition.from.get(target.id) ?? target;
    if (k >= 1 || start === target) return target;
    const heading =
      isFiniteNumber(start.heading) && isFiniteNumber(target.heading)
        ? interpolateHeading(start.heading, target.heading, k)
        : target.heading;
    return {
      ...target,
      position: interpolateLatLng(start.position, target.position, k),
      ...(heading === undefined ? {} : { heading }),
    };
  });
}

/** ¿Hay algo que animar? (si nada se mueve ni gira, basta un setData). */
export function transitionMoves(transition: MarkerTransition): boolean {
  return transition.to.some((target) => {
    const start = transition.from.get(target.id);
    return (
      !!start &&
      start !== target &&
      (start.position.lat !== target.position.lat ||
        start.position.lng !== target.position.lng ||
        (start.heading ?? 0) !== (target.heading ?? 0))
    );
  });
}

// --- Flecha de rumbo ---

/**
 * Flecha de rumbo (triángulo blanco con borde oscuro) como imagen RGBA para `map.addImage`.
 * Apunta al norte; la capa la gira con `icon-rotate` y la separa del ícono con `icon-offset`.
 */
export function headingArrowImage(pixelRatio = 2): RgbaImage {
  const size = 14;
  const width = Math.round(size * pixelRatio);
  const data = new Uint8Array(width * width * 4);
  const outer: [number, number][] = [
    [7, 0.5],
    [13.5, 13],
    [0.5, 13],
  ];
  const inner: [number, number][] = [
    [7, 3.2],
    [11.3, 11.6],
    [2.7, 11.6],
  ];
  const inside = (x: number, y: number, tri: [number, number][]) => {
    const [[ax, ay], [bx, by], [cx, cy]] = tri as [
      [number, number],
      [number, number],
      [number, number],
    ];
    const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
    const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
    const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
  for (let py = 0; py < width; py++) {
    for (let px = 0; px < width; px++) {
      const x = ((px + 0.5) / width) * size;
      const y = ((py + 0.5) / width) * size;
      if (!inside(x, y, outer)) continue;
      const o = (py * width + px) * 4;
      const fill = inside(x, y, inner) ? 255 : 31;
      data[o] = fill;
      data[o + 1] = fill;
      data[o + 2] = fill;
      data[o + 3] = 255;
    }
  }
  return { width, height: width, data };
}
