import { pointInPolygon, type LatLng, type PolygonRings } from '@panter/contracts';
import {
  midpoints,
  toEditable,
  type DrawDraft,
  type EditableRings,
  type VertexRef,
} from './polygon-edit';

/**
 * Polígonos sobre el mapa (geocercas de HU-304, barrios y veredas de HU-309): GeoJSON de las
 * capas del editor y "Probar un punto". Funciones puras, sin maplibre.
 */

/** Polígono que se muestra (el guardado o el que se está editando), con su color. */
export interface MapShape {
  id: string;
  name: string;
  /** Tipo (GeofenceKind, AreaKind…): solo informativo en las propiedades. */
  kind: string;
  active: boolean;
  /** Color de relleno y borde (hex). */
  color: string;
  polygon: PolygonRings;
}

export const EMPTY_COLLECTION = { type: 'FeatureCollection' as const, features: [] };

const ring = (points: readonly LatLng[]): [number, number][] => {
  const coords = points.map((p) => [p.lng, p.lat] as [number, number]);
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) coords.push([...first]);
  return coords;
};

/** Anillos como coordenadas GeoJSON [lng, lat], cerrados (los huecos se dibujan vacíos). */
export function polygonCoordinates(polygon: PolygonRings): [number, number][][] {
  return polygon.filter((r) => r.length > 0).map(ring);
}

/** Un Feature Polygon por figura; la que se edita va resaltada (`editing`). */
export function shapesFeatureCollection(shapes: readonly MapShape[], editingId: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: shapes
      .filter((s) => s.polygon.length > 0 && s.polygon[0]!.length > 0)
      .map((s) => ({
        type: 'Feature' as const,
        id: s.id,
        geometry: { type: 'Polygon' as const, coordinates: polygonCoordinates(s.polygon) },
        properties: {
          id: s.id,
          name: s.name,
          kind: s.kind,
          active: s.active,
          editing: s.id === editingId,
          color: s.color,
        },
      })),
  };
}

/** Vértices del polígono en edición (para arrastrarlos o seleccionarlos). */
export function vertexFeatureCollection(rings: EditableRings, selected: VertexRef | null) {
  return {
    type: 'FeatureCollection' as const,
    features: rings.flatMap((points, r) =>
      points.map((p, v) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] as [number, number] },
        properties: {
          ring: r,
          vertex: v,
          hole: r > 0,
          selected: selected?.ring === r && selected.vertex === v,
        },
      })),
    ),
  };
}

/** Puntos medios de los lados (clic → nuevo vértice). */
export function midpointFeatureCollection(rings: EditableRings) {
  return {
    type: 'FeatureCollection' as const,
    features: midpoints(rings).map((m) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [m.position.lng, m.position.lat] as [number, number],
      },
      properties: { ring: m.ring, side: m.side },
    })),
  };
}

/**
 * Dibujo en curso: la línea abierta por los vértices y los vértices (el primero marcado: un clic
 * sobre él cierra el polígono).
 */
export function draftFeatureCollection(draft: DrawDraft) {
  const line =
    draft.length >= 2
      ? [
          {
            type: 'Feature' as const,
            geometry: {
              type: 'LineString' as const,
              coordinates: draft.map((p) => [p.lng, p.lat] as [number, number]),
            },
            properties: { first: false, index: -1 },
          },
        ]
      : [];
  return {
    type: 'FeatureCollection' as const,
    features: [
      ...line,
      ...draft.map((p, index) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] as [number, number] },
        properties: { first: index === 0, index },
      })),
    ],
  };
}

/** Figuras que cubren el punto (pointInPolygon de contracts, respetando huecos). */
export function shapesAt<T extends { polygon: PolygonRings }>(
  point: LatLng,
  shapes: readonly T[],
): T[] {
  return shapes.filter((s) => pointInPolygon(point, toEditable(s.polygon)));
}

/** "1,02950; −76,61650" (lat; lng con 5 decimales y coma decimal). */
export function formatLatLng(point: { lat: number; lng: number }): string {
  const fmt = (n: number) => n.toFixed(5).replace('.', ',').replace('-', '−');
  return `${fmt(point.lat)}; ${fmt(point.lng)}`;
}

/** Caja [[oeste, sur], [este, norte]] de unos puntos (para centrar el mapa); `null` si no hay. */
export function boundsOf(points: readonly LatLng[]): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of points) {
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }
  return [
    [west, south],
    [east, north],
  ];
}
