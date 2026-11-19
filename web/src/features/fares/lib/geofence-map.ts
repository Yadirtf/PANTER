import {
  GeofenceKind,
  pointInPolygon,
  type Geofence,
  type LatLng,
  type PolygonRings,
} from '@panter/contracts';
import { midpoints, toEditable, type EditableRings, type VertexRef } from './polygon-edit';

/** Geocercas sobre el mapa (HU-304): GeoJSON de las capas y "Probar un punto". */

/** Color de cada tipo de geocerca (relleno y borde). */
export const GEOFENCE_KIND_COLOR: Record<GeofenceKind, string> = {
  [GeofenceKind.AIRPORT]: '#2563eb',
  [GeofenceKind.PERIPHERAL]: '#c2410c',
};

/** Geocerca con el polígono que se muestra (el guardado o el que se está editando). */
export interface ShownGeofence {
  id: string;
  name: string;
  kind: GeofenceKind;
  active: boolean;
  polygon: PolygonRings;
}

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

export function geofencesFeatureCollection(
  geofences: readonly ShownGeofence[],
  editingId: string | null,
) {
  return {
    type: 'FeatureCollection' as const,
    features: geofences.map((g) => ({
      type: 'Feature' as const,
      id: g.id,
      geometry: { type: 'Polygon' as const, coordinates: polygonCoordinates(g.polygon) },
      properties: {
        id: g.id,
        name: g.name,
        kind: g.kind,
        active: g.active,
        editing: g.id === editingId,
        color: GEOFENCE_KIND_COLOR[g.kind],
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

/** Geocercas que cubren el punto (con pointInPolygon de contracts, respetando huecos). */
export function geofencesAt<T extends ShownGeofence>(point: LatLng, geofences: readonly T[]): T[] {
  return geofences.filter((g) => pointInPolygon(point, toEditable(g.polygon)));
}

export function shownGeofence(
  geofence: Geofence,
  polygon: PolygonRings = geofence.polygon,
): ShownGeofence {
  return {
    id: geofence.id,
    name: geofence.name,
    kind: geofence.kind,
    active: geofence.active,
    polygon,
  };
}
