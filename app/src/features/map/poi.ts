// Establecimientos y lugares con nombre del mapa base que se pueden tocar (HU-311).
// - `pois`: capa de puntos de interés de @protomaps/basemaps (tiendas, restaurantes, escuelas,
//   iglesias, parques… de OpenStreetMap), con `name` y `name:es` en sus propiedades.
// - `panter-places` (PLACES_LAYER de @panter/map-style): los puntos clave con ícono propio.
// Al tocar el mapa se consultan esas capas (queryRenderedFeatures) y se toma el primer elemento
// con nombre como destino.
import { LABEL_LANGUAGE, PLACES_LAYER } from '@panter/map-style';
import type { LatLng } from '@panter/contracts';

/** Id de la capa de POI en `layers()` de @protomaps/basemaps (5.x). */
export const BASEMAP_POI_LAYER = 'pois';

/** Capas que se consultan al tocar el mapa, en orden de prioridad. */
export const TAPPABLE_POI_LAYERS: readonly string[] = [PLACES_LAYER, BASEMAP_POI_LAYER];

/** Margen del toque en píxeles: el dedo cubre más que el ícono. */
export const POI_TAP_TOLERANCE_PX = 14;

export interface MapPoi {
  name: string;
  /** Posición del elemento (más precisa que el punto tocado). */
  point: LatLng;
  /** Tipo de OSM (`kind` de Protomaps, p. ej. "restaurant") o `null`. */
  kind: string | null;
  /**
   * Slug del punto clave de PANTER (capa `panter-places`): con él se usa la ubicación del
   * catálogo de la API, no la coordenada fija del estilo.
   */
  placeSlug: string | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Nombre en español si existe; si no, el nombre local. */
export function poiName(properties: Record<string, unknown> | null | undefined): string | null {
  if (!properties) return null;
  return text(properties[`name:${LABEL_LANGUAGE}`]) ?? text(properties.name);
}

/**
 * Primer elemento con nombre de los consultados. Si no trae un punto, se usa el punto tocado.
 */
export function poiFromFeatures(
  features: readonly GeoJSON.Feature[],
  tapped: LatLng,
): MapPoi | null {
  for (const feature of features) {
    const name = poiName(feature.properties);
    if (!name) continue;
    const geometry = feature.geometry;
    const point =
      geometry?.type === 'Point' &&
      typeof geometry.coordinates[0] === 'number' &&
      typeof geometry.coordinates[1] === 'number'
        ? { lng: geometry.coordinates[0], lat: geometry.coordinates[1] }
        : tapped;
    const props = feature.properties ?? {};
    const keyPlace = typeof props.icon === 'string' && props.icon.startsWith('place-');
    return {
      name,
      point,
      kind: text(props.kind),
      placeSlug: keyPlace ? text(props.id) : null,
    };
  }
  return null;
}
