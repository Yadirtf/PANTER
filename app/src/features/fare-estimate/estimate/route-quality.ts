// Avisos de calidad de la ruta (HU-307) a partir de `route.quality` del estimado:
// - Ajuste a la vía: el punto pedido quedó a más de SNAP_WARNING_METERS de donde la ruta empieza
//   o termina. Se marca ese punto (primer o último vértice de la polilínea) y se ofrece mover el
//   pin ahí o dejarlo como está.
// - Ruta inusual: mucho más larga que la línea recta; se dibuja la recta como referencia.
// Sin `quality` (API anterior) no hay avisos y la app se comporta como antes.
import { type LatLng, type RouteQuality, SNAP_WARNING_METERS } from '@panter/contracts';

export type RouteEnd = 'origin' | 'destination';

export interface SnapNotice {
  end: RouteEnd;
  /** Distancia redondeada entre el pin y la vía. */
  meters: number;
  /** Punto de la vía donde la ruta empieza (origen) o termina (destino); `null` sin polilínea. */
  roadPoint: LatLng | null;
  message: string;
}

export interface UnusualNotice {
  detourRatio: number;
  message: string;
  /** Línea recta origen → destino, para dibujarla punteada. */
  straightLine: [LatLng, LatLng];
}

export interface RouteNotices {
  snaps: SnapNotice[];
  unusual: UnusualNotice | null;
}

export const NO_NOTICES: RouteNotices = { snaps: [], unusual: null };

/** Pines que el pasajero ya dejó "así" pese al aviso (se compara por coordenada exacta). */
export interface AcceptedSnaps {
  origin: LatLng | null;
  destination: LatLng | null;
}

export const NO_ACCEPTED_SNAPS: AcceptedSnaps = { origin: null, destination: null };

const samePoint = (a: LatLng | null, b: LatLng) => a !== null && a.lat === b.lat && a.lng === b.lng;

/** 52 → "52 m"; 1480 → "1,5 km" (los ajustes grandes salen en kilómetros). */
export function formatSnapDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace(/\.0$/, '').replace('.', ',')} km`;
}

/** 3.14 → "3,1"; 4 → "4". */
export function formatRatio(ratio: number): string {
  return ratio.toFixed(1).replace(/\.0$/, '').replace('.', ',');
}

export function snapMessage(end: RouteEnd, meters: number): string {
  const subject = end === 'origin' ? 'Tu punto de recogida' : 'Tu destino';
  return `${subject} queda a ${formatSnapDistance(meters)} de la vía más cercana`;
}

export function unusualMessage(detourRatio: number): string {
  return `Esta ruta es más larga de lo normal (${formatRatio(detourRatio)} veces la distancia en línea recta). Revisa el punto de recogida o el destino.`;
}

export interface RouteNoticesInput {
  quality: RouteQuality | undefined;
  /** Ruta decodificada de la polilínea. */
  route: readonly LatLng[];
  origin: LatLng;
  destination: LatLng;
  accepted?: AcceptedSnaps;
}

export function routeNotices({
  quality,
  route,
  origin,
  destination,
  accepted = NO_ACCEPTED_SNAPS,
}: RouteNoticesInput): RouteNotices {
  if (!quality) return NO_NOTICES;
  const snaps: SnapNotice[] = [];
  const ends: [RouteEnd, number, LatLng, LatLng | undefined][] = [
    ['origin', quality.originSnapMeters, origin, route[0]],
    ['destination', quality.destinationSnapMeters, destination, route[route.length - 1]],
  ];
  for (const [end, meters, pin, roadPoint] of ends) {
    if (meters <= SNAP_WARNING_METERS || samePoint(accepted[end], pin)) continue;
    snaps.push({
      end,
      meters: Math.round(meters),
      roadPoint: route.length > 0 && roadPoint ? roadPoint : null,
      message: snapMessage(end, meters),
    });
  }
  const unusual: UnusualNotice | null = quality.unusual
    ? {
        detourRatio: quality.detourRatio,
        message: unusualMessage(quality.detourRatio),
        straightLine: [origin, destination],
      }
    : null;
  return { snaps, unusual };
}
