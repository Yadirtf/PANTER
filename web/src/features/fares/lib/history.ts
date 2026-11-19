import {
  VehicleTypeSchema,
  type FareChange,
  type Geofence,
  type VehicleType,
} from '@panter/contracts';
import { formatCop, VEHICLE_LABEL } from '@/shared/lib/format';
import { GEOFENCE_KIND_LABEL, minutesToTime, PRICING_MODEL_LABEL, VEHICLE_ORDER } from './fares';

/**
 * Historial de cambios de tarifas y geocercas (HU-403): `before` y `after` son instantáneas
 * JSON. Aquí se convierten en un diff legible campo por campo.
 */

/** Campos que no se muestran: identificadores y metadatos (el autor y la fecha ya se muestran). */
const IGNORED = new Set(['vehicleType', 'id', 'updatedAt', 'updatedBy', 'createdAt']);

const MONEY = new Set([
  'baseFare',
  'perKm',
  'perMinute',
  'minimumFare',
  'nightSurcharge',
  'surcharge',
]);
const MINUTES = new Set(['nightStartMinute', 'nightEndMinute']);

export const CHANGE_FIELD_LABEL: Record<string, string> = {
  pricingModel: 'Modelo de cobro',
  baseFare: 'Valor base / banderazo',
  perKm: 'Valor por kilómetro',
  perMinute: 'Valor por minuto',
  minimumFare: 'Tarifa mínima',
  nightSurcharge: 'Recargo nocturno',
  nightStartMinute: 'Inicio del horario nocturno',
  nightEndMinute: 'Fin del horario nocturno',
  roundTo: 'Redondeo',
  active: 'Activa',
  name: 'Nombre',
  kind: 'Tipo',
  surcharge: 'Recargo',
  appliesTo: 'Aplica a',
  polygon: 'Polígono',
  area: 'Polígono',
};

/** La instantánea puede venir con las columnas de la base (snake_case): base_fare → baseFare. */
function camel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function normalize(snapshot: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot ?? {})) out[camel(key)] = value;
  return out;
}

/** Orden estable de los tipos de vehículo para comparar `appliesTo` sin falsos cambios. */
function canonical(field: string, value: unknown): string {
  if (field === 'appliesTo' && Array.isArray(value)) {
    return JSON.stringify(
      [...value].sort(
        (a, b) => VEHICLE_ORDER.indexOf(a as VehicleType) - VEHICLE_ORDER.indexOf(b as VehicleType),
      ),
    );
  }
  return JSON.stringify(value ?? null);
}

function countVertices(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  return value.reduce<number>((sum, ring) => sum + (Array.isArray(ring) ? ring.length : 0), 0);
}

/** Valor legible de un campo: "$ 3.000", "20:00", "Sí", "Mototaxi, Taxi"… */
export function formatChangeValue(field: string, value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (MONEY.has(field) && typeof value === 'number') return formatCop(value);
  if (field === 'roundTo' && typeof value === 'number') return `Múltiplo de ${formatCop(value)}`;
  if (MINUTES.has(field) && typeof value === 'number') return minutesToTime(value);
  if (field === 'active' && typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (field === 'pricingModel' && typeof value === 'string') {
    return PRICING_MODEL_LABEL[value as keyof typeof PRICING_MODEL_LABEL] ?? value;
  }
  if (field === 'kind' && typeof value === 'string') {
    return GEOFENCE_KIND_LABEL[value as keyof typeof GEOFENCE_KIND_LABEL] ?? value;
  }
  if (field === 'appliesTo' && Array.isArray(value)) {
    return (JSON.parse(canonical(field, value)) as unknown[])
      .map((type) => VEHICLE_LABEL[type as VehicleType] ?? String(type))
      .join(', ');
  }
  if (field === 'polygon' || field === 'area') {
    const n = countVertices(value);
    return n === null ? 'Polígono' : `Polígono de ${n} vértices`;
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export interface FieldChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

/** Campos que cambiaron entre dos instantáneas, en orden de aparición. */
export function diffSnapshots(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): FieldChange[] {
  const a = normalize(before);
  const b = normalize(after);
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (field) => !IGNORED.has(field),
  );
  return fields
    .filter((field) => canonical(field, a[field]) !== canonical(field, b[field]))
    .map((field) => ({
      field,
      label: CHANGE_FIELD_LABEL[field] ?? field,
      before: before === null ? '—' : formatChangeValue(field, a[field]),
      after: after === null ? '—' : formatChangeValue(field, b[field]),
    }));
}

export function changeKind(change: Pick<FareChange, 'before' | 'after'>): string {
  if (change.before === null) return 'Creación';
  if (change.after === null) return 'Eliminación';
  return 'Modificación';
}

/** "Tarifa de Taxi" o "Geocerca Aeropuerto Cananguchal (VGZ)". */
export function changeTitle(change: FareChange, geofences: readonly Geofence[]): string {
  if (change.entity === 'FARE_RULE') {
    const type = VehicleTypeSchema.safeParse(change.entityKey);
    return `Tarifa de ${type.success ? VEHICLE_LABEL[type.data] : change.entityKey}`;
  }
  const name =
    geofences.find((g) => g.id === change.entityKey)?.name ??
    (typeof change.after?.name === 'string' ? change.after.name : undefined) ??
    (typeof change.before?.name === 'string' ? change.before.name : undefined) ??
    change.entityKey;
  return `Geocerca ${name}`;
}

export function changeAuthor(change: Pick<FareChange, 'changedBy'>): string {
  return change.changedBy ?? 'Sistema (valores iniciales)';
}

export interface HistoryState {
  items: FareChange[];
  nextCursor: string | null;
}

export function appendHistoryPage(state: HistoryState, page: HistoryState): HistoryState {
  const seen = new Set(state.items.map((item) => item.id));
  return {
    items: [...state.items, ...page.items.filter((item) => !seen.has(item.id))],
    nextCursor: page.nextCursor,
  };
}
