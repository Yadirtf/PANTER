// Búsqueda local en el catálogo (HU-311), sin tildes ni mayúsculas con `searchKey` de contracts
// (la misma normalización que `name_search` en la base). Es local para que funcione sin señal y
// no consulte la API en cada letra.
import {
  AREA_KIND_LABELS,
  AreaKind,
  type AreaSummary,
  type Place,
  PLACE_CATEGORY_LABELS,
  PlaceCategory,
  searchKey,
} from '@panter/contracts';

/**
 * 0 si el nombre empieza por la búsqueda, 1 si contiene todas sus palabras (en el nombre o en
 * los textos extra), `null` si no coincide. Sin búsqueda todo coincide con 0.
 */
export function matchRank(
  query: string,
  name: string,
  extra: readonly string[] = [],
): 0 | 1 | null {
  const key = searchKey(query);
  if (!key) return 0;
  const nameKey = searchKey(name);
  if (nameKey.startsWith(key)) return 0;
  const haystack = [nameKey, ...extra.map(searchKey)].join(' ');
  return key.split(' ').every((word) => haystack.includes(word)) ? 1 : null;
}

function rankAndSort<T>(
  items: readonly T[],
  rank: (item: T) => 0 | 1 | null,
  name: (item: T) => string,
) {
  return items
    .map((item) => ({ item, rank: rank(item), key: searchKey(name(item)) }))
    .filter((entry): entry is { item: T; rank: 0 | 1; key: string } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((entry) => entry.item);
}

export interface AreaGroup {
  kind: AreaKind;
  /** "Barrios" o "Veredas". */
  title: string;
  items: AreaSummary[];
}

const AREA_GROUP_TITLES: Record<AreaKind, string> = { BARRIO: 'Barrios', VEREDA: 'Veredas' };

/** Barrios y veredas activos que coinciden, agrupados por tipo (primero los barrios). */
export function searchAreas(areas: readonly AreaSummary[], query: string): AreaGroup[] {
  const found = rankAndSort(
    areas.filter((area) => area.active),
    // "vereda alto" encuentra "Alto Guineo" (vereda) y "barrio centro" el barrio Centro.
    (area) => matchRank(query, area.name, [AREA_KIND_LABELS[area.kind]]),
    (area) => area.name,
  );
  return [AreaKind.BARRIO, AreaKind.VEREDA]
    .map((kind) => ({
      kind,
      title: AREA_GROUP_TITLES[kind],
      items: found.filter((area) => area.kind === kind),
    }))
    .filter((group) => group.items.length > 0);
}

/** Categorías que tienen al menos un lugar activo, en el orden de PlaceCategory. */
export function placeCategories(places: readonly Place[]): PlaceCategory[] {
  const present = new Set(places.filter((p) => p.active).map((p) => p.category));
  return Object.values(PlaceCategory).filter((category) => present.has(category));
}

/** Lugares activos que coinciden con la búsqueda (nombre, categoría o barrio) y la categoría. */
export function searchCatalogPlaces(
  places: readonly Place[],
  query: string,
  category: PlaceCategory | null = null,
): Place[] {
  return rankAndSort(
    places.filter((place) => place.active && (category === null || place.category === category)),
    (place) =>
      matchRank(query, place.name, [PLACE_CATEGORY_LABELS[place.category], place.area?.name ?? '']),
    (place) => place.name,
  );
}
