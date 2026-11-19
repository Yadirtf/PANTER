import type {
  LayerSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import { PLACES, SERVICE_AREA } from '@panter/contracts';
import { layers } from '@protomaps/basemaps';
import { FONTS, PALETTES, flavorFor, type MapTheme } from './palette';
import { keyPlacesGeoJson } from './places';

/** Id de la fuente vectorial del mapa base y de la fuente GeoJSON de puntos clave. */
export const BASEMAP_SOURCE = 'protomaps';
export const PLACES_SOURCE = 'panter-places';
export const PLACES_LAYER = 'panter-places';

/** Idioma de las etiquetas (name:es de OSM, con `name` de respaldo). */
export const LABEL_LANGUAGE = 'es';
/** Factor de las etiquetas del mapa base: más grandes que las de Protomaps para leer al sol. */
export const LABEL_SCALE = 1.25;

export const ATTRIBUTION =
  '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>';

export interface BuildStyleOptions {
  /**
   * URL del extracto .pmtiles: `https://<api>/tiles/panter-AAAAMMDD.pmtiles` o una URL ya con
   * `pmtiles://` (por ejemplo el archivo descargado en el teléfono). Se antepone `pmtiles://`
   * si falta; el cliente debe registrar el protocolo pmtiles.
   */
  tilesUrl: string;
  /** Plantilla de glifos con {fontstack} y {range}: `https://<api>/tiles/fonts/{fontstack}/{range}.pbf`. */
  glyphsUrl: string;
  /** Carpeta de los sprites: `https://<api>/tiles/sprites/v4`. Se le agrega `/light` o `/dark`. */
  spriteUrl: string;
  theme: MapTheme;
}

/** Caja de servicio como [[oeste, sur], [este, norte]], para `maxBounds` de MapLibre. */
export const SERVICE_AREA_BOUNDS: [[number, number], [number, number]] = [
  [SERVICE_AREA.west, SERVICE_AREA.south],
  [SERVICE_AREA.east, SERVICE_AREA.north],
];

type Expr = unknown;

/** Multiplica el tamaño de texto conservando la forma de la expresión (zoom solo arriba). */
export function scaleTextSize(value: Expr, factor: number): Expr {
  if (typeof value === 'number') return Math.round(value * factor * 10) / 10;
  if (!Array.isArray(value)) return value;
  const [op, ...args] = value as [unknown, ...unknown[]];
  switch (op) {
    case 'interpolate':
    case 'interpolate-hcl':
    case 'interpolate-lab': {
      // ["interpolate", tipo, entrada, z0, v0, z1, v1, ...]
      const [kind, input, ...stops] = args;
      return [
        op,
        kind,
        input,
        ...stops.map((s, i) => (i % 2 === 1 ? scaleTextSize(s, factor) : s)),
      ];
    }
    case 'step': {
      // ["step", entrada, v0, z1, v1, ...]
      const [input, ...rest] = args;
      return [op, input, ...rest.map((s, i) => (i % 2 === 0 ? scaleTextSize(s, factor) : s))];
    }
    case 'case': {
      // ["case", cond, v, cond, v, ..., fallback]
      return [
        op,
        ...args.map((s, i) =>
          i % 2 === 1 || i === args.length - 1 ? scaleTextSize(s, factor) : s,
        ),
      ];
    }
    case 'match': {
      // ["match", entrada, etiqueta, v, etiqueta, v, ..., fallback]
      const [input, ...rest] = args;
      return [
        op,
        input,
        ...rest.map((s, i) =>
          i % 2 === 1 || i === rest.length - 1 ? scaleTextSize(s, factor) : s,
        ),
      ];
    }
    default:
      return value;
  }
}

function enlargeLabels(layer: LayerSpecification): LayerSpecification {
  if (layer.type !== 'symbol' || layer.layout?.['text-size'] === undefined) return layer;
  return {
    ...layer,
    layout: {
      ...layer.layout,
      'text-size': scaleTextSize(layer.layout['text-size'], LABEL_SCALE),
    } as SymbolLayerSpecification['layout'],
  };
}

function placesLayer(theme: MapTheme): SymbolLayerSpecification {
  const palette = PALETTES[theme];
  return {
    id: PLACES_LAYER,
    type: 'symbol',
    source: PLACES_SOURCE,
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.7, 14, 1],
      // Siempre visibles: el ícono no compite con otras etiquetas ni se oculta por colisión.
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-field': ['get', 'name'],
      'text-font': [FONTS.bold],
      'text-size': ['interpolate', ['linear'], ['zoom'], 8, 13, 14, 16],
      'text-anchor': 'top',
      'text-offset': [0, 1.3],
      'text-max-width': 8,
      // El nombre cede ante otras etiquetas si no cabe, pero el ícono queda.
      'text-optional': true,
    },
    paint: {
      'text-color': palette.label,
      'text-halo-color': palette.labelHalo,
      'text-halo-width': 2,
    },
  };
}

function pmtilesUrl(url: string): string {
  return url.startsWith('pmtiles://') ? url : `pmtiles://${url}`;
}

/**
 * Estilo MapLibre de PANTER: capas de @protomaps/basemaps con la paleta propia, etiquetas en
 * español más grandes y, encima, los puntos clave con su ícono. Los íconos (`place-*`) deben
 * registrarse en el mapa con `iconImage`/`iconPngDataUrl` (ver README).
 */
export function buildStyle(options: BuildStyleOptions): StyleSpecification {
  const { tilesUrl, glyphsUrl, spriteUrl, theme } = options;
  if (!glyphsUrl.includes('{fontstack}') || !glyphsUrl.includes('{range}')) {
    throw new Error('glyphsUrl debe contener {fontstack} y {range}');
  }
  const base = layers(BASEMAP_SOURCE, flavorFor(theme), { lang: LABEL_LANGUAGE }).map(
    enlargeLabels,
  );

  return {
    version: 8,
    name: `PANTER ${theme === 'light' ? 'claro' : 'oscuro'}`,
    metadata: { 'panter:theme': theme },
    center: [PLACES.VILLAGARZON_CENTER.lng, PLACES.VILLAGARZON_CENTER.lat],
    zoom: 13,
    glyphs: glyphsUrl,
    sprite: `${spriteUrl.replace(/\/+$/, '')}/${theme}`,
    sources: {
      [BASEMAP_SOURCE]: {
        type: 'vector',
        url: pmtilesUrl(tilesUrl),
        attribution: ATTRIBUTION,
      },
      [PLACES_SOURCE]: {
        type: 'geojson',
        data: keyPlacesGeoJson(),
      },
    },
    layers: [...base, placesLayer(theme)],
  };
}

/** Manifiesto que publica scripts/generar_mapa.sh en /tiles/basemap.json. */
export interface BasemapManifest {
  file: string;
  build: string;
  bounds: [number, number, number, number];
  maxzoom: number;
  size: number;
  sha256: string;
  generatedAt: string;
  pmtilesVersion: string;
  assetsCommit: string;
}

/** Valida el JSON de /tiles/basemap.json. Lanza un error claro si no tiene la forma esperada. */
export function parseBasemapManifest(value: unknown): BasemapManifest {
  const m = value as Partial<BasemapManifest> | null;
  const ok =
    typeof m === 'object' &&
    m !== null &&
    typeof m.file === 'string' &&
    /^panter-\d{8}\.pmtiles$/.test(m.file) &&
    typeof m.build === 'string' &&
    Array.isArray(m.bounds) &&
    m.bounds.length === 4 &&
    m.bounds.every((n) => typeof n === 'number') &&
    typeof m.maxzoom === 'number' &&
    typeof m.size === 'number' &&
    typeof m.sha256 === 'string';
  if (!ok) throw new Error('basemap.json no tiene el formato esperado');
  return m as BasemapManifest;
}

/** URLs del mapa base servido por panter-api (`apiUrl` sin barra final). */
export function basemapUrls(
  apiUrl: string,
  manifest: Pick<BasemapManifest, 'file'>,
): Omit<BuildStyleOptions, 'theme'> {
  const base = `${apiUrl.replace(/\/+$/, '')}/tiles`;
  return {
    tilesUrl: `${base}/${manifest.file}`,
    glyphsUrl: `${base}/fonts/{fontstack}/{range}.pbf`,
    spriteUrl: `${base}/sprites/v4`,
  };
}
