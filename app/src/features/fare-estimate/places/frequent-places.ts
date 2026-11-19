// "Lugares frecuentes" para elegir el destino sin geocodificadores externos (HU-404): los puntos
// clave de @panter/map-style (aeropuerto, parque y sitios turísticos) y los centros de Mocoa y
// Puerto Asís de PLACES. La búsqueda es local, por nombre, sin tildes ni mayúsculas.
import { type LatLng, PLACES } from '@panter/contracts';
import { KEY_PLACES } from '@panter/map-style';

export type FrequentPlaceKind = 'airport' | 'park' | 'tourism' | 'town';

export interface FrequentPlace {
  id: string;
  name: string;
  /** Texto secundario de la lista. */
  description: string;
  kind: FrequentPlaceKind;
  position: LatLng;
  /** Coordenada estimada, por verificar en campo (HU-1102). */
  approximate: boolean;
  /** Otras palabras con las que se encuentra (p. ej. "VGZ"). */
  keywords: readonly string[];
}

const DETAILS: Record<
  string,
  { kind: FrequentPlaceKind; description: string; keywords: string[] }
> = {
  'parque-principal': {
    kind: 'park',
    description: 'Centro de Villagarzón',
    keywords: ['centro', 'plaza', 'villagarzon'],
  },
  'aeropuerto-cananguchal': {
    kind: 'airport',
    description: 'Aeropuerto de Villagarzón (VGZ)',
    keywords: ['aeropuerto', 'vgz', 'skvg', 'vuelo'],
  },
  'pozo-azul': { kind: 'tourism', description: 'Sitio turístico', keywords: ['balneario'] },
  'rio-guineo': { kind: 'tourism', description: 'Sitio turístico', keywords: ['rio', 'balneario'] },
  'cascadas-de-vica': {
    kind: 'tourism',
    description: 'Sitio turístico',
    keywords: ['cascada', 'cascadas'],
  },
  mohano: { kind: 'tourism', description: 'Sitio turístico', keywords: ['reserva'] },
};

export const FREQUENT_PLACES: readonly FrequentPlace[] = [
  ...KEY_PLACES.map((place) => {
    const details = DETAILS[place.id] ?? {
      kind: 'tourism' as const,
      description: 'Lugar de Villagarzón',
      keywords: [],
    };
    return {
      id: place.id,
      name: place.name,
      description: details.description,
      kind: details.kind,
      position: place.position,
      approximate: place.approximate,
      keywords: details.keywords,
    };
  }),
  {
    id: 'centro-mocoa',
    name: 'Centro de Mocoa',
    description: 'Mocoa, Putumayo',
    kind: 'town',
    position: PLACES.MOCOA_CENTER,
    approximate: true,
    keywords: ['mocoa'],
  },
  {
    id: 'centro-puerto-asis',
    name: 'Centro de Puerto Asís',
    description: 'Puerto Asís, Putumayo',
    kind: 'town',
    position: PLACES.PUERTO_ASIS_CENTER,
    approximate: true,
    keywords: ['puerto asis'],
  },
];

/** Minúsculas, sin tildes y con espacios simples. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lugares cuyo nombre, descripción o palabras clave contienen cada palabra buscada. Primero los
 * que empiezan por la búsqueda. Sin texto devuelve la lista completa en su orden.
 */
export function searchPlaces(
  query: string,
  places: readonly FrequentPlace[] = FREQUENT_PLACES,
): FrequentPlace[] {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return [...places];
  const scored = places
    .map((place) => {
      const name = normalizeSearch(place.name);
      const haystack = normalizeSearch(
        [place.name, place.description, ...place.keywords].join(' '),
      );
      if (!words.every((word) => haystack.includes(word))) return null;
      const startsWith = name.startsWith(words.join(' ')) ? 0 : 1;
      return { place, startsWith };
    })
    .filter((entry): entry is { place: FrequentPlace; startsWith: number } => entry !== null);
  return scored.sort((a, b) => a.startsWith - b.startsWith).map((entry) => entry.place);
}
