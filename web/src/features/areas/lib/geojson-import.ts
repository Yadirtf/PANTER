import {
  AREA_IMPORT_MAX_FEATURES,
  AreaImportBodySchema,
  type AreaImportBody,
  type AreaImportResult,
  type AreaKind,
} from '@panter/contracts';
import type { MapShape } from '@/features/geo-editor/lib/polygon-map';
import { AREA_KIND_COLOR } from './areas';

/**
 * Importación de barrios y veredas desde GeoJSON (HU-309): lectura y validación del archivo en
 * el navegador antes de enviarlo. La API valida cada polígono (dryRun) y devuelve los válidos y
 * los errores por índice.
 */

/** Tamaño máximo del archivo: 500 polígonos detallados caben con holgura en 5 MB. */
export const AREA_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export type GeoJsonFeatureCollection = AreaImportBody['geojson'];

export interface ParsedImportFile {
  geojson: GeoJsonFeatureCollection;
  featureCount: number;
  /** Propiedades de texto presentes en las features (para elegir nombre y tipo). */
  propertyKeys: string[];
  suggestedNameProperty: string | null;
  suggestedKindProperty: string | null;
}

export type ParseImportResult = ({ ok: true } & ParsedImportFile) | { ok: false; message: string };

const NAME_CANDIDATES = ['name', 'nombre', 'nom_barrio', 'barrio', 'vereda', 'nom_vereda'];
const KIND_CANDIDATES = ['kind', 'tipo', 'clase'];

const fail = (message: string): ParseImportResult => ({ ok: false, message });

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function suggest(keys: readonly string[], candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    const hit = keys.find((key) => key.toLowerCase() === candidate);
    if (hit) return hit;
  }
  return null;
}

/** Propiedades con valores de texto, en orden de aparición. */
function textPropertyKeys(features: readonly unknown[]): string[] {
  const keys = new Set<string>();
  for (const feature of features) {
    const props = (feature as { properties?: unknown } | null)?.properties;
    if (!props || typeof props !== 'object') continue;
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === 'string' && value.trim()) keys.add(key);
    }
  }
  return [...keys];
}

/**
 * Lee el archivo: JSON válido, tamaño razonable, FeatureCollection y entre 1 y
 * AREA_IMPORT_MAX_FEATURES features. Sugiere las propiedades de nombre ("name", "nombre"…) y de
 * tipo ("tipo", "kind").
 */
export function parseImportFile(text: string, sizeBytes: number): ParseImportResult {
  if (sizeBytes > AREA_IMPORT_MAX_BYTES) {
    return fail(
      `El archivo pesa ${megabytes(sizeBytes)}; el máximo es ${megabytes(AREA_IMPORT_MAX_BYTES)}. Simplifica los polígonos o divide el archivo.`,
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('El archivo no es un GeoJSON válido: no se pudo leer como JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return fail('El archivo no es un GeoJSON válido.');
  }
  const { type, features } = data as { type?: unknown; features?: unknown };
  if (type !== 'FeatureCollection') {
    return fail(
      type === 'Feature' || type === 'Polygon' || type === 'MultiPolygon'
        ? 'El archivo tiene un solo polígono: se espera una FeatureCollection (una colección de polígonos con su nombre).'
        : 'Se espera un GeoJSON de tipo FeatureCollection.',
    );
  }
  if (!Array.isArray(features) || features.length === 0) {
    return fail('La FeatureCollection no tiene polígonos.');
  }
  if (features.length > AREA_IMPORT_MAX_FEATURES) {
    return fail(
      `El archivo tiene ${features.length} polígonos; el máximo por importación es ${AREA_IMPORT_MAX_FEATURES}. Divídelo en varios archivos.`,
    );
  }
  const propertyKeys = textPropertyKeys(features);
  return {
    ok: true,
    geojson: { type: 'FeatureCollection', features },
    featureCount: features.length,
    propertyKeys,
    suggestedNameProperty: suggest(propertyKeys, NAME_CANDIDATES),
    suggestedKindProperty: suggest(propertyKeys, KIND_CANDIDATES),
  };
}

export interface ImportOptions {
  nameProperty: string;
  /** Propiedad con el tipo; vacía = todos del tipo por defecto. */
  kindProperty: string;
  defaultKind: AreaKind;
  source: string;
}

/** Cuerpo de POST /admin/areas/import (validado con el esquema de contracts). */
export function importBody(
  geojson: GeoJsonFeatureCollection,
  options: ImportOptions,
  dryRun: boolean,
): AreaImportBody {
  return AreaImportBodySchema.parse({
    geojson,
    nameProperty: options.nameProperty.trim() || undefined,
    kindProperty: options.kindProperty.trim() || undefined,
    defaultKind: options.defaultKind,
    source: options.source.trim() || undefined,
    dryRun,
  });
}

/** Polígonos válidos de la vista previa, para dibujarlos en el mapa. */
export function previewShapes(result: AreaImportResult): MapShape[] {
  return result.valid.map((item) => ({
    id: `importar-${item.index}`,
    name: item.replacesExisting ? `${item.name} (reemplaza)` : item.name,
    kind: item.kind,
    active: true,
    color: AREA_KIND_COLOR[item.kind],
    polygon: item.polygon,
  }));
}

/** "Se importarán 12 (3 reemplazan a uno existente); 2 con errores." */
export function previewSummary(result: AreaImportResult): string {
  const replacing = result.valid.filter((v) => v.replacesExisting).length;
  const valid =
    result.valid.length === 1 ? '1 polígono válido' : `${result.valid.length} polígonos válidos`;
  const replace =
    replacing === 0
      ? ''
      : replacing === 1
        ? ' (1 reemplaza a uno existente)'
        : ` (${replacing} reemplazan a uno existente)`;
  const errors =
    result.errors.length === 0
      ? 'sin errores'
      : result.errors.length === 1
        ? '1 con errores, que no se importará'
        : `${result.errors.length} con errores, que no se importarán`;
  return `${valid}${replace}; ${errors}.`;
}

/** Nombre de una fuente por defecto a partir del archivo ("Importado de barrios-pot.geojson"). */
export function defaultImportSource(fileName: string): string {
  return `Importado de ${fileName}`.slice(0, 200);
}
