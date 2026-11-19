import {
  FareComponentCode,
  PricingModel,
  type FareComponent,
  type FareRule,
  type GeofenceKind,
} from '@panter/contracts';
import { colombiaMinuteOfDay, isNightMinute } from './colombia-time';

/** Regla con los campos que usa el cálculo (los de `FareRule`, sin auditoría). */
export type PricingRule = Pick<
  FareRule,
  | 'pricingModel'
  | 'baseFare'
  | 'perKm'
  | 'perMinute'
  | 'minimumFare'
  | 'nightSurcharge'
  | 'nightStartMinute'
  | 'nightEndMinute'
  | 'roundTo'
>;

/** Geocerca que cubre el origen o el destino del viaje. */
export interface SurchargeZone {
  id: string;
  name: string;
  kind: GeofenceKind;
  surcharge: number;
}

export interface FareInput {
  rule: PricingRule;
  distanceMeters: number;
  durationSeconds: number;
  /** Instante de salida (epoch ms); la hora se toma en Colombia. */
  departAt: number;
  zones: readonly SurchargeZone[];
}

export interface FareQuote {
  /** Pesos colombianos enteros; igual a la suma del desglose. */
  total: number;
  breakdown: FareComponent[];
  isNight: boolean;
}

const decimal = (value: number) =>
  value.toLocaleString('es-CO', { maximumFractionDigits: 1, minimumFractionDigits: 0 });

/** "Aeropuerto Cananguchal (VGZ)" → "Recargo aeropuerto Cananguchal (VGZ)". */
export function zoneLabel(name: string): string {
  const trimmed = name.trim();
  return `Recargo ${trimmed.charAt(0).toLocaleLowerCase('es-CO')}${trimmed.slice(1)}`;
}

/**
 * Cálculo de la tarifa (RF-05, HU-402). Función pura: sin I/O, sin reloj, sin zona horaria del
 * servidor. Orden (el mismo de la vista previa de la web, HU-403):
 * 1. Base: FLAT → `baseFare`; METERED → banderazo + `perKm`·km + `perMinute`·min (cada
 *    componente redondeado al peso).
 * 2. Si queda por debajo de `minimumFare` → `MINIMUM_ADJUSTMENT` por la diferencia.
 * 3. Recargo nocturno si la hora de Colombia cae en [inicio, fin) (cruza la medianoche).
 * 4. Recargo de cada geocerca que cubre el origen o el destino, una sola vez por geocerca.
 * 5. Redondeo hacia arriba al múltiplo de `roundTo` → `ROUNDING`.
 * Los componentes en $0 (salvo la base) no se muestran. La suma del desglose es el total.
 */
export function calculateFare(input: FareInput): FareQuote {
  const { rule } = input;
  const breakdown: FareComponent[] = [];
  const add = (code: FareComponent['code'], label: string, amount: number, always = false) => {
    if (amount !== 0 || always) breakdown.push({ code, label, amount });
  };

  if (rule.pricingModel === PricingModel.FLAT) {
    add(FareComponentCode.BASE, 'Tarifa del viaje', rule.baseFare, true);
  } else {
    const km = Math.max(0, input.distanceMeters) / 1000;
    const minutes = Math.max(0, input.durationSeconds) / 60;
    add(FareComponentCode.BASE, 'Banderazo', rule.baseFare, true);
    add(FareComponentCode.DISTANCE, `Distancia (${decimal(km)} km)`, Math.round(rule.perKm * km));
    add(
      FareComponentCode.TIME,
      `Tiempo (${Math.round(minutes)} min)`,
      Math.round(rule.perMinute * minutes),
    );
  }

  const metered = breakdown.reduce((sum, c) => sum + c.amount, 0);
  if (metered < rule.minimumFare) {
    add(
      FareComponentCode.MINIMUM_ADJUSTMENT,
      'Ajuste a la tarifa mínima',
      rule.minimumFare - metered,
    );
  }

  const isNight = isNightMinute(
    colombiaMinuteOfDay(input.departAt),
    rule.nightStartMinute,
    rule.nightEndMinute,
  );
  if (isNight) add(FareComponentCode.NIGHT, 'Recargo nocturno', rule.nightSurcharge);

  const seen = new Set<string>();
  for (const zone of input.zones) {
    if (seen.has(zone.id)) continue;
    seen.add(zone.id);
    add(zone.kind, zoneLabel(zone.name), zone.surcharge);
  }

  const subtotal = breakdown.reduce((sum, c) => sum + c.amount, 0);
  const step = Math.max(1, rule.roundTo);
  const total = Math.ceil(subtotal / step) * step;
  add(FareComponentCode.ROUNDING, 'Redondeo', total - subtotal);

  return { total, breakdown, isNight };
}
