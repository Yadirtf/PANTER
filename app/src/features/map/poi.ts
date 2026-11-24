// Lugares con nombre que se pueden tocar en el mapa (HU-311), sobre Google Maps:
// - POI de Google (tiendas, restaurantes, escuelas, iglesias…): evento `onPoiClick` del mapa.
// - Puntos clave de PANTER (KEY_PLACES de @panter/map-style): marcadores con ícono propio; al
//   tocarlos se usa la ubicación del catálogo de la API (placeSlug).
import type { KeyPlace } from '@panter/map-style';
import type { LatLng } from '@panter/contracts';

export interface MapPoi {
  name: string;
  /** Posición del elemento (más precisa que el punto tocado). */
  point: LatLng;
  /** Tipo del lugar, si el mapa lo informa (Google no lo hace en `onPoiClick`). */
  kind: string | null;
  /**
   * Slug del punto clave de PANTER: con él se usa la ubicación del catálogo de la API, no la
   * coordenada fija del paquete de estilo.
   */
  placeSlug: string | null;
}

/**
 * Nombre limpio de un POI de Google. En Android `onPoiClick` puede traer el nombre en varias
 * líneas (p. ej. "Parque Central\nVillagarzón"): se toma la primera. Vacío → null.
 */
export function poiName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const first = raw.split('\n')[0]?.trim() ?? '';
  return first.length > 0 ? first : null;
}

/** POI tocado en el mapa de Google (`onPoiClick`): nombre y coordenada. */
export function poiFromGoogle(event: {
  name?: unknown;
  coordinate: { latitude: number; longitude: number };
}): MapPoi | null {
  const name = poiName(event.name);
  if (!name) return null;
  return {
    name,
    point: { lat: event.coordinate.latitude, lng: event.coordinate.longitude },
    kind: null,
    placeSlug: null,
  };
}

/** Punto clave de PANTER tocado (marcador propio). */
export function poiFromKeyPlace(place: Pick<KeyPlace, 'id' | 'name' | 'position'>): MapPoi {
  return { name: place.name, point: place.position, kind: null, placeSlug: place.id };
}
