import { GeofenceKind, type Geofence, type LatLng, type PolygonRings } from '@panter/contracts';
import {
  shapesAt,
  shapesFeatureCollection,
  type MapShape,
} from '@/features/geo-editor/lib/polygon-map';

/**
 * Geocercas sobre el mapa (HU-304): color por tipo y "Probar un punto". El GeoJSON de las capas
 * y del editor es el genérico de geo-editor.
 */

/** Color de cada tipo de geocerca (relleno y borde). */
export const GEOFENCE_KIND_COLOR: Record<GeofenceKind, string> = {
  [GeofenceKind.AIRPORT]: '#2563eb',
  [GeofenceKind.PERIPHERAL]: '#c2410c',
};

/** Geocerca con el polígono que se muestra (el guardado o el que se está editando). */
export interface ShownGeofence extends MapShape {
  kind: GeofenceKind;
}

export function geofencesFeatureCollection(
  geofences: readonly ShownGeofence[],
  editingId: string | null,
) {
  return shapesFeatureCollection(geofences, editingId);
}

/** Geocercas que cubren el punto (con pointInPolygon de contracts, respetando huecos). */
export function geofencesAt<T extends ShownGeofence>(point: LatLng, geofences: readonly T[]): T[] {
  return shapesAt(point, geofences);
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
    color: GEOFENCE_KIND_COLOR[geofence.kind],
    polygon,
  };
}
