import {
  AREA_KIND_LABELS,
  type AreaKind,
  type CatalogChange,
  type LatLng,
  type PolygonRings,
} from '@panter/contracts';
import type { FieldChange } from '@/features/fares/lib/history';
import { describePolygon, describePolygonChange } from '@/features/geo-editor/lib/polygon-edit';
import { formatLatLng } from '@/features/geo-editor/lib/polygon-map';

/**
 * Historial del catálogo (E15): `before` y `after` son instantáneas JSON de un barrio, vereda o
 * lugar. Aquí se convierten en un diff legible campo por campo, en español.
 */

/** Identificadores y metadatos que no se muestran (el autor y la fecha ya se muestran aparte). */
const IGNORED = new Set([
  'id',
  'nameSearch',
  'createdAt',
  'updatedAt',
  'updatedBy',
  'center',
  'areaId',
]);

export const CATALOG_FIELD_LABEL: Record<string, string> = {
  name: 'Nombre',
  kind: 'Tipo',
  polygon: 'Polígono',
  active: 'Activo',
  source: 'Fuente',
  slug: 'Identificador',
  category: 'Categoría',
  location: 'Ubicación',
  pickupPoint: 'Punto de recogida',
  verified: 'Ubicación verificada en sitio',
  area: 'Barrio o vereda',
};

/** Etiquetas extra por campo (p. ej. las categorías de lugares de HU-310). */
export type ValueLabels = Partial<Record<string, Record<string, string>>>;

const BASE_VALUE_LABELS: ValueLabels = { kind: AREA_KIND_LABELS as Record<AreaKind, string> };

export const CATALOG_ACTION_LABEL: Record<CatalogChange['action'], string> = {
  CREATE: 'Creación',
  UPDATE: 'Modificación',
  IMPORT: 'Importación',
};

/** La instantánea puede venir con las columnas de la base (snake_case): name_search → nameSearch. */
function camel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function normalize(snapshot: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot ?? {})) out[camel(key)] = value;
  return out;
}

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Punto {lat, lng} o GeoJSON Point [lng, lat]. */
export function snapshotPoint(value: unknown): LatLng | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { lat?: unknown; lng?: unknown; type?: unknown; coordinates?: unknown };
  if (isNumber(v.lat) && isNumber(v.lng)) return { lat: v.lat, lng: v.lng };
  if (v.type === 'Point' && Array.isArray(v.coordinates)) {
    const [lng, lat] = v.coordinates as unknown[];
    if (isNumber(lat) && isNumber(lng)) return { lat, lng };
  }
  return null;
}

/** Anillos [{lat, lng}] (formato de contracts) o GeoJSON Polygon. */
export function snapshotPolygon(value: unknown): PolygonRings | null {
  const rings =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as { type?: unknown; coordinates?: unknown }).type === 'Polygon'
        ? (value as { coordinates: unknown }).coordinates
        : null
      : value;
  if (!Array.isArray(rings) || rings.length === 0) return null;
  const out: LatLng[][] = [];
  for (const ring of rings) {
    if (!Array.isArray(ring)) return null;
    const points: LatLng[] = [];
    for (const p of ring) {
      const point = Array.isArray(p)
        ? isNumber(p[0]) && isNumber(p[1])
          ? { lat: p[1], lng: p[0] }
          : null
        : snapshotPoint(p);
      if (!point) return null;
      points.push(point);
    }
    out.push(points);
  }
  return out;
}

function areaName(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const { name, kind } = value as { name?: unknown; kind?: unknown };
  if (typeof name !== 'string') return null;
  const label = typeof kind === 'string' ? AREA_KIND_LABELS[kind as AreaKind] : undefined;
  return label ? `${label} ${name}` : name;
}

/** Valor legible de un campo: "Sí", "Barrio", "1,02950; −76,61650", "Polígono de 5 vértices"… */
export function formatCatalogValue(
  field: string,
  value: unknown,
  labels: ValueLabels = {},
): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  const named = { ...BASE_VALUE_LABELS, ...labels }[field];
  if (named && typeof value === 'string') return named[value] ?? value;
  if (field === 'location' || field === 'pickupPoint') {
    const point = snapshotPoint(value);
    if (point) return formatLatLng(point);
  }
  if (field === 'polygon') {
    const polygon = snapshotPolygon(value);
    return polygon ? `Polígono de ${describePolygon(polygon)}` : 'Polígono';
  }
  if (field === 'area') return areaName(value) ?? '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function canonical(field: string, value: unknown): string {
  if (field === 'polygon') {
    const polygon = snapshotPolygon(value);
    if (polygon) return JSON.stringify(polygon);
  }
  if (field === 'location' || field === 'pickupPoint') {
    const point = snapshotPoint(value);
    if (point) return JSON.stringify(point);
  }
  if (field === 'area' && value && typeof value === 'object') {
    return JSON.stringify((value as { id?: unknown }).id ?? value);
  }
  return JSON.stringify(value ?? null);
}

/** Campos que cambiaron entre dos instantáneas, en orden de aparición. */
export function catalogDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  labels: ValueLabels = {},
): FieldChange[] {
  const a = normalize(before);
  const b = normalize(after);
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (field) => !IGNORED.has(field),
  );
  return fields
    .filter((field) => canonical(field, a[field]) !== canonical(field, b[field]))
    .map((field) => {
      const label = CATALOG_FIELD_LABEL[field] ?? field;
      const oldPolygon = field === 'polygon' ? snapshotPolygon(a[field]) : null;
      const newPolygon = field === 'polygon' ? snapshotPolygon(b[field]) : null;
      if (oldPolygon && newPolygon && before !== null && after !== null) {
        return { field, label, ...describePolygonChange(oldPolygon, newPolygon) };
      }
      return {
        field,
        label,
        before: before === null ? '—' : formatCatalogValue(field, a[field], labels),
        after: after === null ? '—' : formatCatalogValue(field, b[field], labels),
      };
    });
}

export function catalogChangeAuthor(change: Pick<CatalogChange, 'changedBy'>): string {
  return change.changedBy ?? 'Sistema (carga inicial)';
}

export interface CatalogHistoryState {
  items: CatalogChange[];
  nextCursor: string | null;
}

export function appendCatalogPage(
  state: CatalogHistoryState,
  page: CatalogHistoryState,
): CatalogHistoryState {
  const seen = new Set(state.items.map((item) => item.id));
  return {
    items: [...state.items, ...page.items.filter((item) => !seen.has(item.id))],
    nextCursor: page.nextCursor,
  };
}
