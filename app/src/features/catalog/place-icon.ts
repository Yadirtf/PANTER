// Ícono de cada lugar del catálogo en la lista. De @panter/map-style solo se usan los íconos: el
// del punto clave con el mismo slug (aeropuerto, parque, pozo, río, cascada…) o el de su
// categoría; para las demás categorías, uno de Material Icons.
import type { Place, PlaceCategory } from '@panter/contracts';
import { KEY_PLACES, type PlaceIconId } from '@panter/map-style';

export type PlaceIcon =
  { kind: 'map'; id: PlaceIconId } | { kind: 'material'; name: MaterialPlaceIcon };

export type MaterialPlaceIcon =
  | 'flight'
  | 'directions-bus'
  | 'park'
  | 'terrain'
  | 'local-hospital'
  | 'school'
  | 'account-balance'
  | 'storefront'
  | 'restaurant'
  | 'hotel'
  | 'church'
  | 'place';

const MAP_ICON_BY_CATEGORY: Partial<Record<PlaceCategory, PlaceIconId>> = {
  AIRPORT: 'place-airport',
  PARK: 'place-park',
  TOURISM: 'place-nature',
};

const MATERIAL_BY_CATEGORY: Record<PlaceCategory, MaterialPlaceIcon> = {
  AIRPORT: 'flight',
  TRANSPORT: 'directions-bus',
  PARK: 'park',
  TOURISM: 'terrain',
  HEALTH: 'local-hospital',
  EDUCATION: 'school',
  GOVERNMENT: 'account-balance',
  COMMERCE: 'storefront',
  FOOD: 'restaurant',
  LODGING: 'hotel',
  RELIGION: 'church',
  OTHER: 'place',
};

const KEY_PLACE_ICONS = new Map(KEY_PLACES.map((place) => [place.id, place.icon]));

export function placeIcon(place: Pick<Place, 'slug' | 'category'>): PlaceIcon {
  const id = KEY_PLACE_ICONS.get(place.slug) ?? MAP_ICON_BY_CATEGORY[place.category];
  return id
    ? { kind: 'map', id }
    : { kind: 'material', name: MATERIAL_BY_CATEGORY[place.category] };
}
