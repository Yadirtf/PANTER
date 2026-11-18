import { VehicleType } from '@panter/contracts';

/**
 * Formatos de la interfaz armados a mano y no con Intl, para que el servidor (Worker) y el
 * navegador produzcan exactamente el mismo texto sin depender de su ICU (evita diferencias en
 * la hidratación).
 */

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** Colombia no tiene horario de verano: UTC−5 todo el año. */
const COLOMBIA_OFFSET_MS = -5 * 60 * 60 * 1000;

/** "2 nov 2026, 10:30" en hora de Colombia. */
export function formatDate(iso: string): string {
  const local = new Date(new Date(iso).getTime() + COLOMBIA_OFFSET_MS);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}, ${hh}:${mm}`;
}

/** Separador de miles colombiano: 1234567 → "1.234.567". */
export function formatThousands(value: number): string {
  return String(Math.trunc(Math.abs(value))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Pesos colombianos enteros: 3000 → "$ 3.000"; −500 → "−$ 500". */
export function formatCop(value: number): string {
  return `${value < 0 ? '−' : ''}$ ${formatThousands(value)}`;
}

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  [VehicleType.MOTOTAXI]: 'Mototaxi',
  [VehicleType.TAXI]: 'Taxi',
  [VehicleType.JEEP_4X4]: 'Campero 4x4',
};
