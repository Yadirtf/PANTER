// Desglose del estimado (HU-404): filas en el orden del cálculo (base, distancia, tiempo,
// mínima, nocturno, aeropuerto o periferia y redondeo) con los labels que envía la API.
import {
  type FareComponent,
  FareComponentCode,
  type FareEstimateResponse,
  type VehicleType,
} from '@panter/contracts';
import { formatCop } from './format';

type ComponentCode = FareComponent['code'];

/** Orden del cálculo de HU-402 (domain/fare-calculator.ts de la API). */
export const BREAKDOWN_ORDER: readonly ComponentCode[] = [
  FareComponentCode.BASE,
  FareComponentCode.DISTANCE,
  FareComponentCode.TIME,
  FareComponentCode.MINIMUM_ADJUSTMENT,
  FareComponentCode.NIGHT,
  FareComponentCode.AIRPORT,
  FareComponentCode.PERIPHERAL,
  FareComponentCode.ROUNDING,
];

/** Texto de respaldo si la API manda un label vacío. */
export const FALLBACK_LABELS: Record<ComponentCode, string> = {
  BASE: 'Tarifa base',
  DISTANCE: 'Distancia',
  TIME: 'Tiempo',
  MINIMUM_ADJUSTMENT: 'Ajuste a la tarifa mínima',
  NIGHT: 'Recargo nocturno',
  AIRPORT: 'Recargo aeropuerto',
  PERIPHERAL: 'Recargo zona periférica',
  ROUNDING: 'Redondeo',
};

export type BreakdownKind = 'fare' | 'adjustment' | 'surcharge' | 'rounding';

const KIND: Record<ComponentCode, BreakdownKind> = {
  BASE: 'fare',
  DISTANCE: 'fare',
  TIME: 'fare',
  MINIMUM_ADJUSTMENT: 'adjustment',
  NIGHT: 'surcharge',
  AIRPORT: 'surcharge',
  PERIPHERAL: 'surcharge',
  ROUNDING: 'rounding',
};

export interface BreakdownRow {
  code: ComponentCode;
  label: string;
  amount: number;
  /** "$ 4.000"; los recargos y ajustes con "+". */
  formatted: string;
  kind: BreakdownKind;
}

export interface BreakdownView {
  rows: BreakdownRow[];
  total: number;
  formattedTotal: string;
  /** La suma de las filas coincide con el total (lo garantiza el contrato). */
  consistent: boolean;
}

export function mapBreakdown(
  estimate: Pick<FareEstimateResponse, 'breakdown' | 'total'>,
): BreakdownView {
  const order = (code: ComponentCode) => BREAKDOWN_ORDER.indexOf(code);
  const rows = [...estimate.breakdown]
    .map((component, index) => ({ component, index }))
    // Orden del cálculo; dos componentes del mismo código (dos geocercas) conservan su orden.
    .sort((a, b) => order(a.component.code) - order(b.component.code) || a.index - b.index)
    .map(({ component }): BreakdownRow => {
      const kind = KIND[component.code];
      const label = component.label.trim() || FALLBACK_LABELS[component.code];
      const prefix = kind === 'fare' || component.amount < 0 ? '' : '+';
      return {
        code: component.code,
        label,
        amount: component.amount,
        formatted: `${prefix}${formatCop(component.amount)}`,
        kind,
      };
    });
  const sum = rows.reduce((total, row) => total + row.amount, 0);
  return {
    rows,
    total: estimate.total,
    formattedTotal: formatCop(estimate.total),
    consistent: sum === estimate.total,
  };
}

export const VEHICLE_LABELS: Record<VehicleType, string> = {
  MOTOTAXI: 'Mototaxi',
  TAXI: 'Taxi',
  JEEP_4X4: '4x4',
};
