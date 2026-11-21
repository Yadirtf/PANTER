import { PlaceCategory, type Place } from '@panter/contracts';
import {
  KEY_PLACES,
  PLACES_LAYER,
  PLACES_SOURCE,
  type buildStyle,
  type PlaceIconId,
} from '@panter/map-style';

/**
 * Lugares del catálogo (HU-310) en los mapas de la web. Las coordenadas salen de GET /places;
 * de map-style solo se usan el estilo de la capa y los íconos. Funciones puras, sin maplibre.
 */

type Style = ReturnType<typeof buildStyle>;

/** Capa de insignias de color para las categorías sin ícono propio en map-style. */
export const PLACE_BADGE_LAYER = 'panter-places-badge';
/** Anillo ámbar alrededor de los lugares sin verificar en sitio. */
export const PLACE_UNVERIFIED_LAYER = 'panter-places-unverified';

/** Íconos de map-style por categoría (las demás usan una insignia de color). */
export const CATEGORY_ICON: Partial<Record<PlaceCategory, PlaceIconId>> = {
  [PlaceCategory.AIRPORT]: 'place-airport',
  [PlaceCategory.PARK]: 'place-park',
  [PlaceCategory.TOURISM]: 'place-nature',
};

/** Color de cada categoría (insignia del mapa y punto de la lista). */
export const PLACE_CATEGORY_COLOR: Record<PlaceCategory, string> = {
  [PlaceCategory.AIRPORT]: '#1d4ed8',
  [PlaceCategory.TRANSPORT]: '#0f766e',
  [PlaceCategory.PARK]: '#1f7a3f',
  [PlaceCategory.TOURISM]: '#4d7c0f',
  [PlaceCategory.HEALTH]: '#dc2626',
  [PlaceCategory.EDUCATION]: '#7c3aed',
  [PlaceCategory.GOVERNMENT]: '#334155',
  [PlaceCategory.COMMERCE]: '#c2410c',
  [PlaceCategory.FOOD]: '#b45309',
  [PlaceCategory.LODGING]: '#be185d',
  [PlaceCategory.RELIGION]: '#6b21a8',
  [PlaceCategory.OTHER]: '#57534e',
};

/** Color del anillo de "sin verificar". */
export const UNVERIFIED_COLOR = '#f59e0b';

/**
 * Ícono del lugar: los puntos clave que antes vivían en map-style conservan el suyo (mismo slug:
 * Pozo Azul → piscina, Río Guineo → río…); los demás, el de su categoría o ninguno.
 */
export function placeIcon(place: Pick<Place, 'slug' | 'category'>): PlaceIconId | null {
  return KEY_PLACES.find((k) => k.id === place.slug)?.icon ?? CATEGORY_ICON[place.category] ?? null;
}

export interface CatalogPlaceProperties {
  id: string;
  name: string;
  /** Id del ícono de map-style, o '' si se dibuja la insignia de color. */
  icon: string;
  hasIcon: boolean;
  /** Sin verificar en sitio (el estilo de map-style lo llama `approximate`). */
  approximate: boolean;
  active: boolean;
  color: string;
}

/** Lugares como GeoJSON para la fuente `panter-places` del estilo. */
export function catalogPlacesFeatureCollection(
  places: readonly Pick<
    Place,
    'id' | 'slug' | 'name' | 'category' | 'location' | 'verified' | 'active'
  >[],
) {
  return {
    type: 'FeatureCollection' as const,
    features: places.map((place) => {
      const icon = placeIcon(place);
      return {
        type: 'Feature' as const,
        id: place.id,
        geometry: {
          type: 'Point' as const,
          coordinates: [place.location.lng, place.location.lat] as [number, number],
        },
        properties: {
          id: place.id,
          name: place.name,
          icon: icon ?? '',
          hasIcon: icon !== null,
          approximate: !place.verified,
          active: place.active,
          color: PLACE_CATEGORY_COLOR[place.category],
        } satisfies CatalogPlaceProperties,
      };
    }),
  };
}

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/**
 * Estilo de PANTER sin los puntos fijos de map-style: la fuente `panter-places` empieza vacía y
 * la llena <CatalogPlacesLayer> con el catálogo. Agrega la insignia de color (categorías sin
 * ícono) y el anillo de "sin verificar", y atenúa los no verificados y los desactivados.
 */
export function withCatalogPlaces(style: Style): Style {
  const source = style.sources[PLACES_SOURCE];
  const sources = {
    ...style.sources,
    [PLACES_SOURCE]: source && source.type === 'geojson' ? { ...source, data: EMPTY } : source!,
  };
  const layers = style.layers.flatMap((layer) => {
    if (layer.id !== PLACES_LAYER || layer.type !== 'symbol') return [layer];
    const unverified = {
      id: PLACE_UNVERIFIED_LAYER,
      type: 'circle' as const,
      source: PLACES_SOURCE,
      filter: ['==', ['get', 'approximate'], true],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 13, 14, 19],
        'circle-color': UNVERIFIED_COLOR,
        'circle-opacity': 0.15,
        'circle-stroke-color': UNVERIFIED_COLOR,
        'circle-stroke-width': 2.5,
      },
    };
    const badge = {
      id: PLACE_BADGE_LAYER,
      type: 'circle' as const,
      source: PLACES_SOURCE,
      filter: ['==', ['get', 'hasIcon'], false],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 7, 14, 10],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2.5,
        'circle-opacity': ['case', ['get', 'active'], 1, 0.45],
        'circle-stroke-opacity': ['case', ['get', 'active'], 1, 0.45],
      },
    };
    const places = {
      ...layer,
      layout: {
        ...layer.layout,
        // Sin ícono propio: '' = sin imagen (la insignia de color va debajo).
        'icon-image': ['case', ['get', 'hasIcon'], ['get', 'icon'], ''],
      },
      paint: {
        ...layer.paint,
        'icon-opacity': ['case', ['!', ['get', 'active']], 0.45, ['get', 'approximate'], 0.8, 1],
        'text-opacity': ['case', ['get', 'active'], 1, 0.6],
      },
    };
    return [unverified, badge, places] as Style['layers'];
  });
  return { ...style, sources, layers };
}
