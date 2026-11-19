import {
  FareRuleUpdateBodySchema,
  GeofenceKind,
  GeofenceUpdateBodySchema as ContractGeofenceUpdateBodySchema,
  PricingModel,
  VehicleType,
  type FareRule,
  type FareRuleUpdateBody,
  type Geofence,
  type PolygonRings,
} from '@panter/contracts';
import { z } from 'zod';
import { formatThousands } from '@/shared/lib/format';
import { describePolygon, samePolygon, toPolygonPayload, type EditableRings } from './polygon-edit';

/** Edición de tarifas por ADMIN (HU-403): formularios, conversiones y validación. */

export const ADMIN_FARES_PATH = '/admin/tarifas';

export const PRICING_MODEL_LABEL: Record<PricingModel, string> = {
  [PricingModel.FLAT]: 'Tarifa plana',
  [PricingModel.METERED]: 'Banderazo + distancia + tiempo',
};

export const GEOFENCE_KIND_LABEL: Record<GeofenceKind, string> = {
  [GeofenceKind.AIRPORT]: 'Aeropuerto',
  [GeofenceKind.PERIPHERAL]: 'Zona periférica',
};

export const VEHICLE_ORDER: readonly VehicleType[] = Object.values(VehicleType);

// --- Horas ---

/** "20:00" → 1200. Acepta "H:MM" y "HH:MM" (24 h); `null` si no es una hora válida. */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 1200 → "20:00" (valor de un `<input type="time">`). */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 1200 → "8:00 p. m."; 0 → "12:00 a. m." (como se dice en Colombia). */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, '0');
  const suffix = h < 12 ? 'a. m.' : 'p. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

/** ¿El minuto cae en el horario nocturno? Cruza la medianoche si start > end; start = end: nunca. */
export function isNightMinute(minuteOfDay: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end;
}

/** "de 8:00 p. m. a 5:00 a. m. (cruza la medianoche)". */
export function nightRangeText(start: number, end: number): string {
  if (start === end) return 'sin horario nocturno (inicio y fin iguales)';
  const crosses = start > end ? ' (cruza la medianoche)' : '';
  return `de ${formatClock(start)} a ${formatClock(end)}${crosses}`;
}

// --- Montos ---

/** Máximo de dígitos que se aceptan al escribir un monto (el contrato llega a $ 1.000.000). */
const MAX_MONEY_DIGITS = 7;

/** Texto del campo mientras se escribe: deja solo dígitos y pone puntos de miles ("3000" → "3.000"). */
export function formatMoneyInput(raw: string): string {
  const digits = raw
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, MAX_MONEY_DIGITS);
  return digits ? formatThousands(Number(digits)) : '';
}

/** "3.000" o "$ 3.000" → 3000; vacío o sin dígitos → NaN (lo rechaza el esquema). */
export function parseMoney(value: string): number {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : Number.NaN;
}

// --- Formulario de una regla ---

export const MONEY_FIELDS = [
  'baseFare',
  'perKm',
  'perMinute',
  'minimumFare',
  'nightSurcharge',
] as const;
export type MoneyField = (typeof MONEY_FIELDS)[number];

export interface RuleForm {
  pricingModel: PricingModel;
  baseFare: string;
  perKm: string;
  perMinute: string;
  minimumFare: string;
  nightSurcharge: string;
  /** "20:00" */
  nightStart: string;
  nightEnd: string;
  roundTo: string;
  active: boolean;
}

export type RuleFormField = keyof RuleForm;

export function ruleToForm(rule: FareRuleUpdateBody): RuleForm {
  return {
    pricingModel: rule.pricingModel,
    baseFare: formatThousands(rule.baseFare),
    perKm: formatThousands(rule.perKm),
    perMinute: formatThousands(rule.perMinute),
    minimumFare: formatThousands(rule.minimumFare),
    nightSurcharge: formatThousands(rule.nightSurcharge),
    nightStart: minutesToTime(rule.nightStartMinute),
    nightEnd: minutesToTime(rule.nightEndMinute),
    roundTo: formatThousands(rule.roundTo),
    active: rule.active,
  };
}

/** Solo los campos editables de una regla guardada. */
export function ruleBody(rule: FareRule): FareRuleUpdateBody {
  return FareRuleUpdateBodySchema.parse(rule);
}

export const RULE_FIELD_LABEL: Record<RuleFormField, string> = {
  pricingModel: 'Modelo de cobro',
  baseFare: 'Valor del viaje / banderazo',
  perKm: 'Valor por kilómetro',
  perMinute: 'Valor por minuto',
  minimumFare: 'Tarifa mínima',
  nightSurcharge: 'Recargo nocturno',
  nightStart: 'Inicio del horario nocturno',
  nightEnd: 'Fin del horario nocturno',
  roundTo: 'Redondear al múltiplo de',
  active: 'Activa',
};

/** Etiqueta del valor base según el modelo. */
export function baseFareLabel(model: PricingModel): string {
  return model === PricingModel.FLAT ? 'Valor del viaje' : 'Banderazo';
}

const MONEY_MESSAGE = 'Escribe un valor entre $ 0 y $ 1.000.000.';
const TIME_MESSAGE = 'Escribe la hora en formato de 24 horas, por ejemplo 20:00.';

/** Mensaje en español para un campo con error. */
export const RULE_FIELD_ERROR: Record<RuleFormField, string> = {
  pricingModel: 'Elige un modelo de cobro.',
  baseFare: MONEY_MESSAGE,
  perKm: MONEY_MESSAGE,
  perMinute: MONEY_MESSAGE,
  minimumFare: MONEY_MESSAGE,
  nightSurcharge: MONEY_MESSAGE,
  nightStart: TIME_MESSAGE,
  nightEnd: TIME_MESSAGE,
  roundTo: 'Escribe un múltiplo entre $ 1 y $ 1.000.',
  active: 'Valor inválido.',
};

/** Campo del formulario que corresponde a cada campo del cuerpo. */
const BODY_TO_FORM: Record<keyof FareRuleUpdateBody, RuleFormField> = {
  pricingModel: 'pricingModel',
  baseFare: 'baseFare',
  perKm: 'perKm',
  perMinute: 'perMinute',
  minimumFare: 'minimumFare',
  nightSurcharge: 'nightSurcharge',
  nightStartMinute: 'nightStart',
  nightEndMinute: 'nightEnd',
  roundTo: 'roundTo',
  active: 'active',
};

export type FieldErrors<F extends string> = Partial<Record<F, string>>;

export type ParseResult<T, F extends string> =
  { ok: true; body: T } | { ok: false; errors: FieldErrors<F> };

/**
 * Convierte el formulario en el cuerpo de PUT /admin/fares/rules/:vehicleType y lo valida con
 * FareRuleUpdateBodySchema (el mismo esquema que valida el BFF y la API). En el modelo FLAT los
 * campos por km y por minuto no se muestran y se envían con el valor que ya tenían.
 */
export function formToRuleBody(form: RuleForm): ParseResult<FareRuleUpdateBody, RuleFormField> {
  const candidate = {
    pricingModel: form.pricingModel,
    baseFare: parseMoney(form.baseFare),
    perKm: parseMoney(form.perKm),
    perMinute: parseMoney(form.perMinute),
    minimumFare: parseMoney(form.minimumFare),
    nightSurcharge: parseMoney(form.nightSurcharge),
    nightStartMinute: timeToMinutes(form.nightStart) ?? Number.NaN,
    nightEndMinute: timeToMinutes(form.nightEnd) ?? Number.NaN,
    roundTo: parseMoney(form.roundTo),
    active: form.active,
  };
  const parsed = FareRuleUpdateBodySchema.safeParse(candidate);
  if (parsed.success) return { ok: true, body: parsed.data };
  const errors: FieldErrors<RuleFormField> = {};
  for (const issue of parsed.error.issues) {
    const field = BODY_TO_FORM[issue.path[0] as keyof FareRuleUpdateBody];
    if (field && !errors[field]) errors[field] = RULE_FIELD_ERROR[field];
  }
  return { ok: false, errors };
}

/** ¿Se muestran los campos por km y por minuto? Solo en METERED. */
export function showsMeteredFields(model: PricingModel): boolean {
  return model === PricingModel.METERED;
}

// --- Geocercas ---

/**
 * Cuerpo de PUT /admin/fares/geofences/:id: el esquema del contrato (polígono opcional: si no
 * viene, la API conserva el actual) con el nombre recortado.
 */
export const GeofenceUpdateBodySchema = ContractGeofenceUpdateBodySchema.extend({
  name: z.string().trim().min(1).max(80),
});
export type GeofenceUpdateBody = z.infer<typeof GeofenceUpdateBodySchema>;

export interface GeofenceForm {
  name: string;
  surcharge: string;
  appliesTo: VehicleType[];
  active: boolean;
}
export type GeofenceFormField = keyof GeofenceForm;

export function geofenceToForm(geofence: Geofence): GeofenceForm {
  return {
    name: geofence.name,
    surcharge: formatThousands(geofence.surcharge),
    appliesTo: [...geofence.appliesTo],
    active: geofence.active,
  };
}

export function geofenceBody(geofence: Geofence): GeofenceUpdateBody {
  return {
    name: geofence.name,
    surcharge: geofence.surcharge,
    appliesTo: geofence.appliesTo,
    active: geofence.active,
  };
}

export const GEOFENCE_FIELD_ERROR: Record<GeofenceFormField, string> = {
  name: 'Escribe un nombre de 1 a 80 caracteres.',
  surcharge: MONEY_MESSAGE,
  appliesTo: 'Elige al menos un tipo de vehículo.',
  active: 'Valor inválido.',
};

export function formToGeofenceBody(
  form: GeofenceForm,
): ParseResult<GeofenceUpdateBody, GeofenceFormField> {
  const parsed = GeofenceUpdateBodySchema.safeParse({
    name: form.name,
    surcharge: parseMoney(form.surcharge),
    // Orden estable para que el historial no muestre cambios falsos.
    appliesTo: VEHICLE_ORDER.filter((type) => form.appliesTo.includes(type)),
    active: form.active,
  });
  if (parsed.success) return { ok: true, body: parsed.data };
  const errors: FieldErrors<GeofenceFormField> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as GeofenceFormField;
    if (field in GEOFENCE_FIELD_ERROR && !errors[field])
      errors[field] = GEOFENCE_FIELD_ERROR[field];
  }
  return { ok: false, errors };
}

/**
 * Cuerpo final del PUT: los campos del formulario y, solo si cambió, el polígono editado
 * (anillos cerrados). Sin cambios en el mapa no se envía `polygon` y la API conserva el actual.
 */
export function geofenceSaveBody(
  fields: GeofenceUpdateBody,
  savedPolygon: PolygonRings,
  editedRings: EditableRings | null,
): GeofenceUpdateBody {
  const { polygon: _ignored, ...rest } = fields;
  if (!editedRings || samePolygon(savedPolygon, editedRings)) return rest;
  return { ...rest, polygon: toPolygonPayload(editedRings) };
}

/** Vértices del anillo exterior y de los huecos. */
export function polygonSummary(geofence: { polygon: PolygonRings }): string {
  return describePolygon(geofence.polygon);
}

/** "1,02950; −76,61650" (lat; lng con 5 decimales y coma decimal). */
export function formatLatLng(point: { lat: number; lng: number }): string {
  const fmt = (n: number) => n.toFixed(5).replace('.', ',').replace('-', '−');
  return `${fmt(point.lat)}; ${fmt(point.lng)}`;
}
