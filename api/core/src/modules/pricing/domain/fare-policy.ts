import {
  inBoundingBox,
  PricingModel,
  SERVICE_AREA,
  VehicleType,
  type FareRuleUpdateBody,
  type LatLng,
  type PolygonRings,
} from '@panter/contracts';

/** Problema de validación de negocio, con la ruta del campo (mismo formato que los de Zod). */
export interface PolicyIssue {
  path: string;
  code: string;
  message: string;
}

const formatCop = (value: number) => `$${value.toLocaleString('es-CO')}`;

/** Monto de referencia que `roundTo` debe dividir exactamente: los totales quedan en $50, $100… */
export const ROUND_TO_REFERENCE = 1000;

/**
 * Reglas de negocio de una tarifa (HU-401), además de los rangos del contrato:
 * - montos ≥ 0 (la tarifa mínima incluida);
 * - `roundTo` divide exactamente $1.000 (1, 50, 100, 500, 1.000…): un redondeo a $300 daría
 *   totales como $3.300 que no se pagan con billetes y monedas de forma natural;
 * - FLAT no cobra por km ni por minuto;
 * - con recargo nocturno, el horario no puede empezar y terminar a la misma hora.
 */
export function fareRuleIssues(rule: FareRuleUpdateBody): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const amounts = ['baseFare', 'perKm', 'perMinute', 'minimumFare', 'nightSurcharge'] as const;
  for (const field of amounts) {
    if (!Number.isInteger(rule[field]) || rule[field] < 0) {
      issues.push({
        path: field,
        code: 'negative_amount',
        message: 'El valor debe ser un número entero de pesos mayor o igual a cero.',
      });
    }
  }
  if (rule.roundTo < 1 || ROUND_TO_REFERENCE % rule.roundTo !== 0) {
    issues.push({
      path: 'roundTo',
      code: 'round_to_not_divisor',
      message: `El redondeo debe dividir exactamente ${formatCop(ROUND_TO_REFERENCE)} (por ejemplo $50, $100, $500 o $1.000).`,
    });
  }
  if (rule.pricingModel === PricingModel.FLAT) {
    for (const field of ['perKm', 'perMinute'] as const) {
      if (rule[field] !== 0) {
        issues.push({
          path: field,
          code: 'flat_with_metered_amount',
          message: 'La tarifa plana no cobra por kilómetro ni por minuto: deja este valor en 0.',
        });
      }
    }
  }
  if (rule.nightSurcharge > 0 && rule.nightStartMinute === rule.nightEndMinute) {
    issues.push({
      path: 'nightEndMinute',
      code: 'empty_night_window',
      message: 'El horario nocturno debe terminar a una hora distinta de la de inicio.',
    });
  }
  return issues;
}

const sameVertex = (a: LatLng, b: LatLng) => a.lat === b.lat && a.lng === b.lng;

/** Vértices distintos de un anillo (sin el de cierre ni repetidos consecutivos). */
function distinctVertices(ring: readonly LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const p of ring) if (!out.some((q) => sameVertex(p, q))) out.push(p);
  return out;
}

/**
 * Validación del polígono de una geocerca antes de enviarlo a PostGIS (que además comprueba
 * `ST_IsValid`: autointersecciones, huecos fuera del borde…):
 * - cada anillo tiene al menos 3 vértices distintos;
 * - todos los vértices están dentro del área de servicio.
 */
export function polygonIssues(polygon: PolygonRings): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  if (polygon.length === 0) {
    return [{ path: 'polygon', code: 'empty_polygon', message: 'Dibuja el borde de la zona.' }];
  }
  polygon.forEach((ring, r) => {
    if (distinctVertices(ring).length < 3) {
      issues.push({
        path: `polygon.${r}`,
        code: 'ring_too_small',
        message: 'Cada borde de la zona necesita al menos 3 puntos distintos.',
      });
    }
    const outside = ring.findIndex((p) => !inBoundingBox(p, SERVICE_AREA));
    if (outside >= 0) {
      issues.push({
        path: `polygon.${r}.${outside}`,
        code: 'outside_service_area',
        message:
          'La zona debe quedar dentro del área de servicio (Villagarzón, Mocoa y el corredor a Puerto Asís).',
      });
    }
  });
  return issues;
}

/** Tipos de vehículo sin repetir y en el orden del enum (así comparar dos listas es exacto). */
export function normalizeVehicleTypes<T extends string>(types: readonly T[]): T[] {
  const order: string[] = Object.values(VehicleType);
  return [...new Set(types)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}
