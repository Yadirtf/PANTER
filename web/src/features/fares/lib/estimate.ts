import {
  FareComponentCode,
  GeofenceKind,
  haversineMeters,
  PLACES,
  pointInPolygon,
  PricingModel,
  VehicleType,
  type FareComponent,
  type FareEstimateResponse,
  type FareRuleUpdateBody,
  type Geofence,
  type LatLng,
} from '@panter/contracts';
import { formatCop } from '@/shared/lib/format';
import { isNightMinute } from './fares';

/**
 * Cálculo local del estimado para la vista previa de /admin/tarifas (HU-403). Sigue el contrato
 * del desglose de POST /fares/estimate (FareComponent: BASE, DISTANCE, TIME,
 * MINIMUM_ADJUSTMENT, NIGHT, AIRPORT, PERIPHERAL, ROUNDING; la suma es igual al total):
 *
 * 1. BASE: FLAT = valor del viaje; METERED = banderazo.
 * 2. METERED: DISTANCE = perKm × km y TIME = perMinute × minutos (redondeados al peso).
 * 3. MINIMUM_ADJUSTMENT: lo que falte para llegar a la tarifa mínima.
 * 4. NIGHT: recargo fijo si la salida cae en el horario nocturno (hora de Colombia).
 * 5. AIRPORT / PERIPHERAL: recargo de cada geocerca activa que aplique al vehículo y contenga
 *    el origen o el destino (una sola vez por viaje y geocerca).
 * 6. ROUNDING: lo que falte para el siguiente múltiplo de `roundTo` (siempre hacia arriba).
 *
 * Es una APROXIMACIÓN: no hay ruta real; la distancia es la línea recta por un factor de calles
 * y el tiempo sale de una velocidad promedio. El valor oficial lo calcula la API (HU-402).
 */

export type FareRuleInput = FareRuleUpdateBody & { vehicleType: VehicleType };

export interface TripInput {
  vehicleType: VehicleType;
  origin: LatLng;
  destination: LatLng;
  distanceMeters: number;
  durationSeconds: number;
  /** Minuto del día de la salida, hora de Colombia. */
  departMinute: number;
}

export type LocalEstimate = Pick<FareEstimateResponse, 'total' | 'breakdown' | 'isNight'>;

/** "7,4 km" */
function km(meters: number): string {
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

export function estimateFare(
  rule: FareRuleInput,
  geofences: readonly Geofence[],
  trip: TripInput,
): LocalEstimate {
  const breakdown: FareComponent[] = [];
  const add = (code: FareComponent['code'], label: string, amount: number) => {
    if (amount !== 0 || code === FareComponentCode.BASE) breakdown.push({ code, label, amount });
  };

  const metered = rule.pricingModel === PricingModel.METERED;
  add(FareComponentCode.BASE, metered ? 'Banderazo' : 'Tarifa plana', rule.baseFare);
  if (metered) {
    const minutes = trip.durationSeconds / 60;
    add(
      FareComponentCode.DISTANCE,
      `Distancia (${km(trip.distanceMeters)})`,
      Math.round((rule.perKm * trip.distanceMeters) / 1000),
    );
    add(
      FareComponentCode.TIME,
      `Tiempo (${Math.round(minutes)} min)`,
      Math.round(rule.perMinute * minutes),
    );
  }
  const subtotal = breakdown.reduce((sum, c) => sum + c.amount, 0);
  if (subtotal < rule.minimumFare) {
    add(
      FareComponentCode.MINIMUM_ADJUSTMENT,
      'Ajuste a la tarifa mínima',
      rule.minimumFare - subtotal,
    );
  }

  const isNight = isNightMinute(trip.departMinute, rule.nightStartMinute, rule.nightEndMinute);
  if (isNight) add(FareComponentCode.NIGHT, 'Recargo nocturno', rule.nightSurcharge);

  for (const geofence of geofences) {
    if (!geofence.active || !geofence.appliesTo.includes(rule.vehicleType)) continue;
    const touches =
      pointInPolygon(trip.origin, geofence.polygon) ||
      pointInPolygon(trip.destination, geofence.polygon);
    if (!touches) continue;
    add(
      geofence.kind === GeofenceKind.AIRPORT
        ? FareComponentCode.AIRPORT
        : FareComponentCode.PERIPHERAL,
      `Recargo ${geofence.name}`,
      geofence.surcharge,
    );
  }

  const beforeRounding = breakdown.reduce((sum, c) => sum + c.amount, 0);
  const rounded = Math.ceil(beforeRounding / rule.roundTo) * rule.roundTo;
  add(
    FareComponentCode.ROUNDING,
    `Redondeo al múltiplo de ${formatCop(rule.roundTo)}`,
    rounded - beforeRounding,
  );

  return { total: rounded, breakdown, isNight };
}

// --- Casos fijos de la vista previa ---

/** Las calles no van en línea recta: distancia aproximada = línea recta × este factor. */
export const ROUTE_FACTOR = 1.3;
/** Velocidad promedio supuesta en Villagarzón y la vía al aeropuerto. */
export const AVERAGE_SPEED_KMH = 25;

/** Un punto del casco urbano (dentro del hueco de la zona periférica), a ~1 km del parque. */
export const URBAN_DESTINATION: LatLng = { lat: 1.0345, lng: -76.611 };

export interface PreviewCase {
  id: string;
  title: string;
  description: string;
  vehicleType: VehicleType;
  origin: LatLng;
  destination: LatLng;
  departMinute: number;
}

export const PREVIEW_CASES: readonly PreviewCase[] = [
  {
    id: 'mototaxi-centro',
    title: 'Mototaxi en el centro',
    description: 'Del parque principal a un barrio del casco urbano, a las 10:00 a. m.',
    vehicleType: VehicleType.MOTOTAXI,
    origin: PLACES.VILLAGARZON_CENTER,
    destination: URBAN_DESTINATION,
    departMinute: 10 * 60,
  },
  {
    id: 'taxi-aeropuerto',
    title: 'Taxi del centro al aeropuerto',
    description: 'Del parque principal al aeropuerto Cananguchal, a las 10:00 a. m.',
    vehicleType: VehicleType.TAXI,
    origin: PLACES.VILLAGARZON_CENTER,
    destination: PLACES.AIRPORT_VGZ,
    departMinute: 10 * 60,
  },
  {
    id: 'taxi-aeropuerto-noche',
    title: 'Taxi del centro al aeropuerto, de noche',
    description: 'El mismo viaje a las 9:30 p. m.',
    vehicleType: VehicleType.TAXI,
    origin: PLACES.VILLAGARZON_CENTER,
    destination: PLACES.AIRPORT_VGZ,
    departMinute: 21 * 60 + 30,
  },
];

/** Ruta aproximada sin servicio de rutas: línea recta × ROUTE_FACTOR a AVERAGE_SPEED_KMH. */
export function approximateTrip(preview: PreviewCase): TripInput {
  const distanceMeters = haversineMeters(preview.origin, preview.destination) * ROUTE_FACTOR;
  return {
    vehicleType: preview.vehicleType,
    origin: preview.origin,
    destination: preview.destination,
    distanceMeters,
    durationSeconds: distanceMeters / ((AVERAGE_SPEED_KMH * 1000) / 3600),
    departMinute: preview.departMinute,
  };
}
