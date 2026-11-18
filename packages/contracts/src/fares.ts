import { z } from 'zod';
import { VehicleTypeSchema } from './enums';
import { LatLngSchema, PolygonRingsSchema } from './geo';

/**
 * Motor de tarifas (E4: HU-401 a HU-404, RF-05). Valores en pesos colombianos (COP) enteros.
 * Las reglas y las geocercas son editables por ADMIN sin desplegar código.
 */

export const PricingModel = {
  /** Tarifa plana por viaje (mototaxi urbano). */
  FLAT: 'FLAT',
  /** Banderazo + distancia + tiempo, con tarifa mínima (taxi). */
  METERED: 'METERED',
} as const;
export type PricingModel = (typeof PricingModel)[keyof typeof PricingModel];
export const PricingModelSchema = z.enum(PricingModel);

const Cop = z.number().int().min(0).max(1_000_000);
/** Minutos desde la medianoche, hora de Colombia. */
const MinuteOfDay = z.number().int().min(0).max(1439);

export const FareRuleSchema = z.object({
  vehicleType: VehicleTypeSchema,
  pricingModel: PricingModelSchema,
  /** FLAT: valor del viaje. METERED: banderazo. */
  baseFare: Cop,
  /** Solo METERED. */
  perKm: Cop,
  /** Solo METERED. */
  perMinute: Cop,
  minimumFare: Cop,
  /** Recargo fijo en el horario nocturno. */
  nightSurcharge: Cop,
  /** Inicio y fin del horario nocturno (cruza la medianoche si start > end). */
  nightStartMinute: MinuteOfDay,
  nightEndMinute: MinuteOfDay,
  /** El total se redondea hacia arriba a este múltiplo (p. ej. 100 COP). */
  roundTo: z.number().int().min(1).max(1000),
  active: z.boolean(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string().nullable(),
});
export type FareRule = z.infer<typeof FareRuleSchema>;

/** PUT /admin/fares/:vehicleType */
export const FareRuleUpdateBodySchema = FareRuleSchema.omit({
  vehicleType: true,
  updatedAt: true,
  updatedBy: true,
});
export type FareRuleUpdateBody = z.infer<typeof FareRuleUpdateBodySchema>;

export const GeofenceKind = {
  AIRPORT: 'AIRPORT',
  PERIPHERAL: 'PERIPHERAL',
} as const;
export type GeofenceKind = (typeof GeofenceKind)[keyof typeof GeofenceKind];
export const GeofenceKindSchema = z.enum(GeofenceKind);

export const GeofenceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(80),
  kind: GeofenceKindSchema,
  polygon: PolygonRingsSchema,
  /** Recargo si el origen o el destino caen dentro (una sola vez por viaje y geocerca). */
  surcharge: Cop,
  /** Tipos de vehículo a los que aplica. */
  appliesTo: z.array(VehicleTypeSchema).min(1),
  active: z.boolean(),
});
export type Geofence = z.infer<typeof GeofenceSchema>;

export const FareConfigResponseSchema = z.object({
  rules: z.array(FareRuleSchema),
  geofences: z.array(GeofenceSchema),
});
export type FareConfigResponse = z.infer<typeof FareConfigResponseSchema>;

export const FareChangeSchema = z.object({
  id: z.uuid(),
  entity: z.enum(['FARE_RULE', 'GEOFENCE']),
  entityKey: z.string(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  changedBy: z.string().nullable(),
  changedAt: z.iso.datetime(),
});
export type FareChange = z.infer<typeof FareChangeSchema>;

export const FareHistoryResponseSchema = z.object({
  items: z.array(FareChangeSchema),
  nextCursor: z.string().nullable(),
});

// POST /fares/estimate
export const FareEstimateBodySchema = z.object({
  origin: LatLngSchema,
  destination: LatLngSchema,
  vehicleType: VehicleTypeSchema,
  /** Hora de salida (ISO); por defecto, ahora. Sirve para reservas y para el recargo nocturno. */
  departAt: z.iso.datetime().optional(),
});
export type FareEstimateBody = z.infer<typeof FareEstimateBodySchema>;

export const FareComponentCode = {
  BASE: 'BASE',
  DISTANCE: 'DISTANCE',
  TIME: 'TIME',
  MINIMUM_ADJUSTMENT: 'MINIMUM_ADJUSTMENT',
  NIGHT: 'NIGHT',
  AIRPORT: 'AIRPORT',
  PERIPHERAL: 'PERIPHERAL',
  ROUNDING: 'ROUNDING',
} as const;
export const FareComponentCodeSchema = z.enum(FareComponentCode);

export const FareComponentSchema = z.object({
  code: FareComponentCodeSchema,
  /** Texto para mostrar, en español (p. ej. "Recargo aeropuerto Cananguchal"). */
  label: z.string(),
  amount: z.number().int(),
});
export type FareComponent = z.infer<typeof FareComponentSchema>;

export const RouteSummarySchema = z.object({
  distanceMeters: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  /** Polilínea codificada (precisión 5), decodificable con decodePolyline. */
  polyline: z.string(),
});
export type RouteSummary = z.infer<typeof RouteSummarySchema>;

export const FareEstimateResponseSchema = z.object({
  vehicleType: VehicleTypeSchema,
  currency: z.literal('COP'),
  total: z.number().int().nonnegative(),
  /** La suma de los componentes es igual a `total`. */
  breakdown: z.array(FareComponentSchema).min(1),
  route: RouteSummarySchema,
  isNight: z.boolean(),
  /** Hasta cuándo se respeta este valor al pedir el viaje. */
  validUntil: z.iso.datetime(),
});
export type FareEstimateResponse = z.infer<typeof FareEstimateResponseSchema>;

export const FareRoutes = {
  ESTIMATE: '/fares/estimate',
  ADMIN_CONFIG: '/admin/fares',
  /** PUT */
  ADMIN_RULE: '/admin/fares/rules/:vehicleType',
  /** PUT */
  ADMIN_GEOFENCE: '/admin/fares/geofences/:id',
  ADMIN_HISTORY: '/admin/fares/history',
} as const;

/** Vigencia del estimado (coincide con la caché de rutas, §6.2). */
export const FARE_ESTIMATE_TTL_SECONDS = 10 * 60;
