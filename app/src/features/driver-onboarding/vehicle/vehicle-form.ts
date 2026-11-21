// Paso 1 del onboarding (HU-203): datos del vehículo. Lógica pura (sin React) para probarla en
// Node: máscara de placa por tipo, validación con el contrato y mapeo de errores de la API.
import {
  ApiErrorCode,
  type DriverApplyBody,
  DriverApplyBodySchema,
  isValidPlateFor,
  MIN_VEHICLE_YEAR,
  maxVehicleYear,
  normalizePlate,
  type DriverProfile,
  VehicleType,
} from '@panter/contracts';
import { errorMessage } from '../../../shared/api/error-messages';

export interface VehicleTypeOption {
  readonly type: VehicleType;
  readonly label: string;
  readonly description: string;
  /** Nombre del ícono de MaterialCommunityIcons (@expo/vector-icons). */
  readonly icon: 'moped' | 'taxi' | 'jeepney';
  /** El campero 4x4 es de la Fase 2 (tarifa por destino aún sin definir): "Próximamente". */
  readonly available: boolean;
}

export const VEHICLE_TYPE_OPTIONS: readonly VehicleTypeOption[] = [
  {
    type: VehicleType.MOTOTAXI,
    label: 'Mototaxi',
    description: 'Viajes urbanos en Villagarzón',
    icon: 'moped',
    available: true,
  },
  {
    type: VehicleType.TAXI,
    label: 'Taxi',
    description: 'Ciudad, aeropuerto y pueblos cercanos',
    icon: 'taxi',
    available: true,
  },
  {
    type: VehicleType.JEEP_4X4,
    label: 'Campero 4x4',
    description: 'Vías rurales y balnearios',
    icon: 'jeepney',
    available: false,
  },
];

export function isVehicleTypeAvailable(type: VehicleType): boolean {
  return VEHICLE_TYPE_OPTIONS.some((option) => option.type === type && option.available);
}

/** Ejemplo de placa para el tipo, en el formato en que se muestra. */
export function platePlaceholder(type: VehicleType | null): string {
  return type === VehicleType.MOTOTAXI ? 'ABC 12D' : 'ABC 123';
}

const LETTER = /[A-Z]/;
const DIGIT = /\d/;

/**
 * Patrón de cada posición: 3 letras + 3 números (carros y camperos) o 3 letras + 2 números +
 * 1 letra (motos y mototaxis). Sin tipo elegido, la última posición acepta ambas.
 */
function slotPatterns(type: VehicleType | null): readonly RegExp[] {
  const last = type === VehicleType.MOTOTAXI ? LETTER : type === null ? /[A-Z\d]/ : DIGIT;
  return [LETTER, LETTER, LETTER, DIGIT, DIGIT, last];
}

/**
 * Máscara de la placa mientras se escribe: mayúsculas, descarta lo que no encaja en la posición
 * y la muestra como "ABC 12D". `normalizePlate` del resultado da la placa del contrato.
 */
export function formatPlateInput(type: VehicleType | null, raw: string): string {
  const patterns = slotPatterns(type);
  const chars: string[] = [];
  for (const char of normalizePlate(raw).replace(/[^A-Z\d]/g, '')) {
    if (chars.length >= patterns.length) break;
    if (patterns[chars.length]?.test(char)) chars.push(char);
  }
  const value = chars.join('');
  return value.length > 3 ? `${value.slice(0, 3)} ${value.slice(3)}` : value;
}

/** Placa normalizada ("ABC12D") en el formato de pantalla ("ABC 12D"). */
export function displayPlate(plate: string): string {
  const value = normalizePlate(plate);
  return value.length > 3 ? `${value.slice(0, 3)} ${value.slice(3)}` : value;
}

export interface VehicleFormValues {
  readonly vehicleType: VehicleType | null;
  /** Placa tal como se muestra ("ABC 12D"). */
  readonly plate: string;
  readonly brand: string;
  readonly model: string;
  readonly color: string;
  /** Texto del campo; se convierte a número al validar. */
  readonly year: string;
}

export type VehicleField = keyof VehicleFormValues;
export type VehicleFormErrors = Partial<Record<VehicleField, string>>;

export const EMPTY_VEHICLE_FORM: VehicleFormValues = {
  vehicleType: null,
  plate: '',
  brand: '',
  model: '',
  color: '',
  year: '',
};

// Límites del año del modelo: los mismos del contrato (la API valida con ellos).
export { MIN_VEHICLE_YEAR, maxVehicleYear } from '@panter/contracts';

/** Formulario precargado con el vehículo ya registrado (GET /drivers/me). */
export function vehicleFormFromProfile(profile: Pick<DriverProfile, 'vehicle'>): VehicleFormValues {
  const { vehicle } = profile;
  return {
    vehicleType: vehicle.vehicleType,
    plate: displayPlate(vehicle.plate),
    brand: vehicle.brand,
    model: vehicle.model,
    color: vehicle.color,
    year: String(vehicle.year),
  };
}

/** Al cambiar de tipo se vuelve a aplicar la máscara (p. ej. "ABC 12D" → "ABC 12" en taxi). */
export function changeVehicleType(values: VehicleFormValues, type: VehicleType): VehicleFormValues {
  return { ...values, vehicleType: type, plate: formatPlateInput(type, values.plate) };
}

export type VehicleValidation =
  | { readonly ok: true; readonly body: DriverApplyBody }
  | { readonly ok: false; readonly errors: VehicleFormErrors };

function requiredText(value: string, label: string, max: number): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return `Escribe ${label}.`;
  if (trimmed.length > max) return `Máximo ${max} caracteres.`;
  return undefined;
}

/** Valida el formulario y arma el cuerpo de POST /drivers/apply (validado con el contrato). */
export function validateVehicleForm(
  values: VehicleFormValues,
  now: Date = new Date(),
): VehicleValidation {
  const errors: VehicleFormErrors = {};
  const type = values.vehicleType;
  if (!type) errors.vehicleType = 'Elige el tipo de vehículo.';
  else if (!isVehicleTypeAvailable(type)) {
    errors.vehicleType = 'Este tipo de vehículo estará disponible próximamente.';
  }

  const plate = normalizePlate(values.plate);
  if (!plate) errors.plate = 'Escribe la placa.';
  else if (type && !isValidPlateFor(type, plate)) {
    errors.plate =
      type === VehicleType.MOTOTAXI
        ? 'Placa de moto inválida: 3 letras, 2 números y 1 letra (ej.: ABC 12D).'
        : 'Placa inválida: 3 letras y 3 números (ej.: ABC 123).';
  }

  const brand = requiredText(values.brand, 'la marca', 40);
  if (brand) errors.brand = brand;
  const model = requiredText(values.model, 'la línea o modelo', 40);
  if (model) errors.model = model;
  const color = requiredText(values.color, 'el color', 30);
  if (color) errors.color = color;

  const max = maxVehicleYear(now);
  const yearText = values.year.trim();
  const year = Number(yearText);
  if (!yearText) errors.year = 'Escribe el año del modelo.';
  else if (!/^\d{4}$/.test(yearText) || year < MIN_VEHICLE_YEAR || year > max) {
    errors.year = `El año debe estar entre ${MIN_VEHICLE_YEAR} y ${max}.`;
  }

  if (Object.keys(errors).length > 0 || !type) return { ok: false, errors };

  const parsed = DriverApplyBodySchema.safeParse({
    vehicleType: type,
    plate,
    brand: values.brand.trim(),
    model: values.model.trim(),
    color: values.color.trim(),
    year,
  });
  if (!parsed.success) {
    // No debería pasar: las reglas de arriba son las del contrato.
    return { ok: false, errors: { plate: 'Revisa los datos del vehículo.' } };
  }
  return { ok: true, body: parsed.data };
}

export type ApplyErrorDisplay =
  /** Error de un campo concreto (la placa ya está registrada). */
  | { readonly kind: 'field'; readonly field: VehicleField; readonly message: string }
  /** Ya existe una solicitud: se recarga GET /drivers/me y se precarga el formulario. */
  | { readonly kind: 'alreadyApplied'; readonly message: string }
  | { readonly kind: 'general'; readonly message: string };

/** Traduce el error de POST /drivers/apply a lo que muestra el paso 1. */
export function applyErrorDisplay(error: { code: string }): ApplyErrorDisplay {
  switch (error.code) {
    case ApiErrorCode.PLATE_ALREADY_REGISTERED:
      return {
        kind: 'field',
        field: 'plate',
        message:
          'Esta placa ya está registrada por otro conductor. Revísala o comunícate con PANTER si el vehículo es tuyo.',
      };
    case ApiErrorCode.DRIVER_ALREADY_APPLIED:
      return {
        kind: 'alreadyApplied',
        message: 'Ya tienes una solicitud de conductor. Cargamos los datos que registraste.',
      };
    default:
      return { kind: 'general', message: errorMessage(error) };
  }
}
