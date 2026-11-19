// De dónde lee el mapa sus teselas, glifos y sprites: de panter-api o de la copia descargada
// para usar sin señal (§6.1). Funciones puras: las pantallas solo pasan el resultado a
// `buildStyle` de @panter/map-style.
import {
  type BasemapManifest,
  type BuildStyleOptions,
  basemapUrls,
  FONTS,
} from '@panter/map-style';

export type BasemapUrls = Omit<BuildStyleOptions, 'theme'>;

/** Copia completa del mapa guardada en el teléfono. */
export interface LocalBasemap {
  /** Build (AAAAMMDD) y archivo de la copia. */
  build: string;
  file: string;
  /** URI `file://` de la carpeta con el .pmtiles, `fonts/` y `sprites/`. */
  rootUri: string;
}

export type MapSource =
  | { kind: 'remote'; build: string; urls: BasemapUrls }
  | { kind: 'local'; build: string; urls: BasemapUrls }
  /** Sin manifiesto (ni guardado) y sin copia local: no hay de dónde leer el mapa. */
  | { kind: 'unavailable'; reason: 'offline' | 'error' };

const trimSlash = (value: string) => value.replace(/\/+$/, '');

/**
 * URLs de la copia local. MapLibre Native lee `pmtiles://file://…` con su PMTilesFileSource
 * (por rangos, sobre LocalFileSource), y los glifos y sprites como `file://`.
 */
export function localBasemapUrls(rootUri: string, file: string): BasemapUrls {
  const root = trimSlash(rootUri);
  return {
    tilesUrl: `pmtiles://${root}/${file}`,
    glyphsUrl: `${root}/fonts/{fontstack}/{range}.pbf`,
    spriteUrl: `${root}/sprites/v4`,
  };
}

export interface ResolveMapSourceInput {
  apiUrl: string;
  /** Manifiesto de la API o, si no respondió, la última copia guardada. */
  manifest: BasemapManifest | null;
  /** true si `manifest` llegó ahora de la API. */
  manifestFresh: boolean;
  /** Estado de la red según el sistema. */
  online: boolean;
  /** Copia descargada (solo conductores). */
  local: LocalBasemap | null;
}

/**
 * Regla (HU-303):
 * - Con copia local y sin red (o con la API sin responder) → la copia local.
 * - Con manifiesto → panter-api (con la copia guardada del manifiesto, MapLibre aún puede
 *   servir desde su caché lo que ya se vio).
 * - Sin manifiesto pero con copia local → la copia local.
 * - Si no, el mapa no está disponible.
 */
export function resolveMapSource(input: ResolveMapSourceInput): MapSource {
  const { apiUrl, manifest, manifestFresh, online, local } = input;
  const localSource = (copy: LocalBasemap): MapSource => ({
    kind: 'local',
    build: copy.build,
    urls: localBasemapUrls(copy.rootUri, copy.file),
  });

  if (local && (!online || !manifestFresh)) return localSource(local);
  if (manifest) {
    return { kind: 'remote', build: manifest.build, urls: basemapUrls(apiUrl, manifest) };
  }
  if (local) return localSource(local);
  return { kind: 'unavailable', reason: online ? 'error' : 'offline' };
}

/**
 * Rangos de glifos que publica scripts/generar_mapa.sh (GLYPH_RANGES): latín básico y
 * extendido, puntuación y símbolos. Son los que hacen falta para los nombres en español.
 */
export const OFFLINE_GLYPH_RANGES = [
  '0-255',
  '256-511',
  '512-767',
  '768-1023',
  '7680-7935',
  '8192-8447',
  '8448-8703',
] as const;

/** Sprites de basemaps-assets por tema, en densidad normal y @2x. */
export const OFFLINE_SPRITES = ['light', 'dark'] as const;

/**
 * Archivos de glifos y sprites que se guardan junto al .pmtiles, como rutas relativas a /tiles
 * (y a la carpeta local). Las fuentes salen del estilo (`FONTS`) para que no se desincronicen.
 */
export function offlineAssetPaths(): string[] {
  const fonts = Object.values(FONTS).flatMap((font) =>
    OFFLINE_GLYPH_RANGES.map((range) => `fonts/${font}/${range}.pbf`),
  );
  const sprites = OFFLINE_SPRITES.flatMap((theme) =>
    ['', '@2x'].flatMap((suffix) =>
      ['json', 'png'].map((ext) => `sprites/v4/${theme}${suffix}.${ext}`),
    ),
  );
  return [...fonts, ...sprites];
}

/** URL pública de un archivo de /tiles (las fuentes tienen espacios: se codifica cada tramo). */
export function tileAssetUrl(apiUrl: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${trimSlash(apiUrl)}/tiles/${encoded}`;
}
