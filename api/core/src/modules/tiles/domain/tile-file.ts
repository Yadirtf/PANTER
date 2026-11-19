/**
 * Archivos públicos del mapa base (HU-301) y su política de caché. Solo se sirven los nombres de
 * esta lista blanca: cualquier otra ruta (incluidas `..`, barras invertidas o claves de otros
 * buckets) responde 404 sin consultar R2.
 *
 * Los nombres y las fuentes deben coincidir con scripts/generar_mapa.sh, que los sube.
 */

/** - immutable: el nombre cambia con el contenido (panter-AAAAMMDD.pmtiles).
 *  - asset: glifos y sprites de un commit fijado de basemaps-assets; cambian muy rara vez.
 *  - manifest: basemap.json, que apunta al .pmtiles vigente y cambia al regenerar el mapa. */
export type CachePolicy = 'immutable' | 'asset' | 'manifest';

export interface TileFile {
  /** Clave del objeto en el bucket R2. */
  key: string;
  contentType: string;
  policy: CachePolicy;
  /**
   * Rango de glifos que no se subió (el script solo sube los del español): se responde un PBF
   * vacío en lugar de 404 para que MapLibre no registre errores con nombres en otros alfabetos.
   */
  emptyIfMissing: boolean;
}

export const BASEMAP_MANIFEST = 'basemap.json';

/** Fuentes que usan las capas de @protomaps/basemaps (packages/map-style). */
export const GLYPH_FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'] as const;

/** Sprites de basemaps-assets (sprites/v4/<tema>), uno por tema del estilo. */
export const SPRITE_THEMES = ['light', 'dark'] as const;

const MAX_PATH_LENGTH = 96;
const BASEMAP_RE = /^panter-(\d{4})(\d{2})(\d{2})\.pmtiles$/;
const GLYPH_RE = /^fonts\/([A-Za-z ]+)\/(\d{1,5})-(\d{1,5})\.pbf$/;
const SPRITE_RE = /^sprites\/v4\/([a-z]+)(@2x)?\.(json|png)$/;

/** Nombre del extracto de una fecha de build de Protomaps (AAAAMMDD). */
export function basemapFileName(buildDate: string): string {
  return `panter-${buildDate}.pmtiles`;
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 2020 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** Resuelve la ruta pedida a un archivo de la lista blanca, o `null` si no está permitido. */
export function resolveTileFile(path: string): TileFile | null {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return null;

  if (path === BASEMAP_MANIFEST) {
    return {
      key: path,
      contentType: 'application/json',
      policy: 'manifest',
      emptyIfMissing: false,
    };
  }

  const basemap = BASEMAP_RE.exec(path);
  if (basemap) {
    const [, year, month, day] = basemap.map(Number) as [number, number, number, number];
    if (!isValidDate(year, month, day)) return null;
    // octet-stream: el borde de Cloudflare no comprime este tipo, lo que rompería los rangos.
    return {
      key: path,
      contentType: 'application/octet-stream',
      policy: 'immutable',
      emptyIfMissing: false,
    };
  }

  const glyph = GLYPH_RE.exec(path);
  if (glyph) {
    const [, font, startText, endText] = glyph as unknown as [string, string, string, string];
    const start = Number(startText);
    const end = Number(endText);
    const knownFont = (GLYPH_FONTS as readonly string[]).includes(font);
    if (!knownFont || start % 256 !== 0 || end !== start + 255 || end > 65535) return null;
    return {
      key: path,
      contentType: 'application/x-protobuf',
      policy: 'asset',
      emptyIfMissing: true,
    };
  }

  const sprite = SPRITE_RE.exec(path);
  if (sprite) {
    const [, theme, , ext] = sprite as unknown as [string, string, string | undefined, string];
    if (!(SPRITE_THEMES as readonly string[]).includes(theme)) return null;
    return {
      key: path,
      contentType: ext === 'json' ? 'application/json' : 'image/png',
      policy: 'asset',
      emptyIfMissing: false,
    };
  }

  return null;
}

const ONE_YEAR = 31_536_000;
const ONE_WEEK = 604_800;
const FIVE_MINUTES = 300;

/** Segundos que una copia (Cache API, navegador o CDN) puede reutilizarse sin revalidar. */
export function maxAgeSeconds(policy: CachePolicy): number {
  switch (policy) {
    case 'immutable':
      return ONE_YEAR;
    case 'asset':
      return ONE_WEEK;
    case 'manifest':
      return FIVE_MINUTES;
  }
}

/** Cabecera Cache-Control pública de cada política. */
export function cacheControl(policy: CachePolicy): string {
  switch (policy) {
    case 'immutable':
      return `public, max-age=${ONE_YEAR}, immutable`;
    case 'asset':
      return `public, max-age=${ONE_WEEK}, stale-while-revalidate=86400`;
    case 'manifest':
      return `public, max-age=${FIVE_MINUTES}`;
  }
}
