import type { Flavor } from '@protomaps/basemaps';

export type MapTheme = 'light' | 'dark';

/**
 * Paleta limitada de PANTER. Pocos colores, con mucho contraste entre vías y fondo para que el
 * mapa se lea bien al sol y de noche en teléfonos de gama baja:
 * - selva: el verde de la región (bosque, parques y fondo de la tierra con tono verde);
 * - agua: ríos y quebradas, que en Putumayo sirven de referencia (Guineo, Mocoa, Putumayo);
 * - vías: blancas con borde oscuro en el tema claro y claras sobre fondo oscuro en el oscuro; la
 *   troncal (vía Mocoa–Villagarzón–Puerto Asís) en ámbar para que destaque siempre.
 */
export interface PanterPalette {
  /** Fondo fuera de la tierra (nunca se ve en la caja de servicio, salvo en los bordes). */
  background: string;
  earth: string;
  /** Bosque y selva, en dos tonos (bajo y alto zoom). */
  jungle: string;
  jungleDeep: string;
  /** Parques, potreros y áreas verdes urbanas. */
  park: string;
  water: string;
  waterLabel: string;
  urban: string;
  buildings: string;
  /** Vías locales y su borde. */
  road: string;
  roadCasing: string;
  /** Troncales y vías principales. */
  highway: string;
  highwayCasing: string;
  /** Texto principal y su halo. */
  label: string;
  labelHalo: string;
  /** Texto secundario (barrios, veredas, vías menores). */
  labelMuted: string;
  boundary: string;
}

export const PALETTES: Record<MapTheme, PanterPalette> = {
  light: {
    background: '#dfe8d8',
    earth: '#eef2e6',
    jungle: '#cfe5c3',
    jungleDeep: '#a9d39a',
    park: '#bfe0b0',
    water: '#5fb4e6',
    waterLabel: '#155b8a',
    urban: '#e9e6df',
    buildings: '#d6d1c7',
    road: '#ffffff',
    roadCasing: '#8a8f86',
    highway: '#f5b324',
    highwayCasing: '#8a5a00',
    label: '#1f2a22',
    labelHalo: '#ffffff',
    labelMuted: '#4b5a50',
    boundary: '#8c7aa8',
  },
  dark: {
    background: '#0d1611',
    earth: '#16211a',
    jungle: '#183324',
    jungleDeep: '#1d4a30',
    park: '#1f4630',
    water: '#1c5f8f',
    waterLabel: '#8fd0ff',
    urban: '#222a25',
    buildings: '#2f3833',
    road: '#5c6862',
    roadCasing: '#0d1611',
    highway: '#e0a028',
    highwayCasing: '#3b2a05',
    label: '#f1f5ef',
    labelHalo: '#0d1611',
    labelMuted: '#b5c2b9',
    boundary: '#a08cc0',
  },
};

/** Fuentes del estilo. Deben existir en R2 (scripts/generar_mapa.sh las sube). */
export const FONTS = {
  regular: 'Noto Sans Regular',
  bold: 'Noto Sans Medium',
  italic: 'Noto Sans Italic',
} as const;

/** Convierte la paleta en el "flavor" que esperan las capas de @protomaps/basemaps. */
export function flavorFor(theme: MapTheme): Flavor {
  const p = PALETTES[theme];
  return {
    background: p.background,
    earth: p.earth,
    park_a: p.park,
    park_b: p.park,
    hospital: p.urban,
    industrial: p.urban,
    school: p.urban,
    wood_a: p.jungle,
    wood_b: p.jungleDeep,
    pedestrian: p.urban,
    scrub_a: p.jungle,
    scrub_b: p.jungle,
    glacier: p.earth,
    sand: p.urban,
    beach: p.urban,
    aerodrome: p.urban,
    runway: p.buildings,
    water: p.water,
    zoo: p.park,
    military: p.urban,

    tunnel_other_casing: p.roadCasing,
    tunnel_minor_casing: p.roadCasing,
    tunnel_link_casing: p.roadCasing,
    tunnel_major_casing: p.roadCasing,
    tunnel_highway_casing: p.highwayCasing,
    tunnel_other: p.road,
    tunnel_minor: p.road,
    tunnel_link: p.road,
    tunnel_major: p.road,
    tunnel_highway: p.highway,

    pier: p.buildings,
    buildings: p.buildings,

    minor_service_casing: p.roadCasing,
    minor_casing: p.roadCasing,
    link_casing: p.roadCasing,
    major_casing_late: p.roadCasing,
    highway_casing_late: p.highwayCasing,
    other: p.road,
    minor_service: p.road,
    minor_a: p.road,
    minor_b: p.road,
    link: p.road,
    major_casing_early: p.roadCasing,
    major: p.road,
    highway_casing_early: p.highwayCasing,
    highway: p.highway,

    railway: p.labelMuted,
    boundaries: p.boundary,

    bridges_other_casing: p.roadCasing,
    bridges_minor_casing: p.roadCasing,
    bridges_link_casing: p.roadCasing,
    bridges_major_casing: p.roadCasing,
    bridges_highway_casing: p.highwayCasing,
    bridges_other: p.road,
    bridges_minor: p.road,
    bridges_link: p.road,
    bridges_major: p.road,
    bridges_highway: p.highway,

    roads_label_minor: p.labelMuted,
    roads_label_minor_halo: p.labelHalo,
    roads_label_major: p.label,
    roads_label_major_halo: p.labelHalo,
    ocean_label: p.waterLabel,
    subplace_label: p.labelMuted,
    subplace_label_halo: p.labelHalo,
    city_label: p.label,
    city_label_halo: p.labelHalo,
    state_label: p.labelMuted,
    state_label_halo: p.labelHalo,
    country_label: p.labelMuted,
    address_label: p.labelMuted,
    address_label_halo: p.labelHalo,

    regular: FONTS.regular,
    bold: FONTS.bold,
    italic: FONTS.italic,

    // Íconos de POI del sprite de Protomaps, reducidos a los tonos de la paleta.
    pois: {
      blue: p.waterLabel,
      green: theme === 'light' ? '#2e7d32' : '#7cc98a',
      lapis: p.waterLabel,
      pink: p.boundary,
      red: theme === 'light' ? '#b3261e' : '#ff8a80',
      slategray: p.labelMuted,
      tangerine: theme === 'light' ? '#a15c00' : p.highway,
      turquoise: p.waterLabel,
    },
    landcover: {
      grassland: p.park,
      barren: p.earth,
      urban_area: p.urban,
      farmland: p.park,
      glacier: p.earth,
      scrub: p.jungle,
      forest: p.jungleDeep,
    },
  };
}
