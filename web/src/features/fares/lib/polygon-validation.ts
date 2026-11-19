import { isInServiceArea, pointInPolygon, type LatLng, type PolygonRings } from '@panter/contracts';
import { MIN_RING_VERTICES, toEditable } from './polygon-edit';

/**
 * Validación del polígono de una geocerca en el navegador (HU-304), antes de enviarlo. La API
 * repite las reglas y PostGIS comprueba `ST_IsValid`; aquí se avisa sin esperar la respuesta:
 * - cada anillo con al menos 3 vértices distintos y con área;
 * - todos los vértices dentro del área de servicio (SERVICE_AREA es una caja: si los vértices
 *   están dentro, el polígono entero también);
 * - ningún lado cruza ni toca a otro del mismo anillo (autointersección);
 * - los huecos quedan dentro del borde exterior, sin cruzarlo ni cruzarse entre sí, y ningún
 *   hueco queda dentro de otro.
 * Se calcula en el plano lng/lat, como `ST_IsValid` sobre la geometría.
 */

export type PolygonIssueCode =
  | 'empty'
  | 'too_few_vertices'
  | 'no_area'
  | 'outside_service_area'
  | 'self_intersection'
  | 'rings_cross'
  | 'hole_outside'
  | 'hole_in_hole';

export interface PolygonIssue {
  code: PolygonIssueCode;
  /** Anillo afectado (0 = borde exterior). */
  ring: number;
  message: string;
}

export function ringName(ring: number): string {
  return ring === 0 ? 'El borde exterior' : `El hueco ${ring}`;
}

type Segment = readonly [LatLng, LatLng];

/** > 0 si c está a la izquierda de a→b, < 0 a la derecha, 0 si son colineales. */
function orient(a: LatLng, b: LatLng, c: LatLng): number {
  const v = (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
  // Tolerancia relativa para errores de redondeo en coordenadas de 6 decimales.
  return Math.abs(v) < 1e-18 ? 0 : v;
}

function onSegment(a: LatLng, b: LatLng, p: LatLng): boolean {
  return (
    orient(a, b, p) === 0 &&
    p.lng >= Math.min(a.lng, b.lng) &&
    p.lng <= Math.max(a.lng, b.lng) &&
    p.lat >= Math.min(a.lat, b.lat) &&
    p.lat <= Math.max(a.lat, b.lat)
  );
}

/** ¿Los segmentos se cruzan o se tocan (incluye extremos y tramos colineales)? */
export function segmentsIntersect([p1, p2]: Segment, [q1, q2]: Segment): boolean {
  const d1 = orient(q1, q2, p1);
  const d2 = orient(q1, q2, p2);
  const d3 = orient(p1, p2, q1);
  const d4 = orient(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return (
    onSegment(q1, q2, p1) || onSegment(q1, q2, p2) || onSegment(p1, p2, q1) || onSegment(p1, p2, q2)
  );
}

const same = (a: LatLng, b: LatLng) => a.lat === b.lat && a.lng === b.lng;

function sides(ring: readonly LatLng[]): Segment[] {
  return ring.map((p, i) => [p, ring[(i + 1) % ring.length]!] as const);
}

/** Área con signo (fórmula del cordón), en grados². */
function signedArea(ring: readonly LatLng[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.lng * b.lat - b.lng * a.lat;
  }
  return sum / 2;
}

/** ¿Algún lado del anillo cruza o toca a otro que no sea su vecino? */
export function ringSelfIntersects(ring: readonly LatLng[]): boolean {
  const n = ring.length;
  if (n < 3) return false;
  if (ring.some((p, i) => ring.findIndex((q) => same(p, q)) !== i)) return true; // vértice repetido
  const s = sides(ring);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (!adjacent) {
        if (segmentsIntersect(s[i]!, s[j]!)) return true;
        continue;
      }
      // Lados vecinos: comparten un vértice; se "cruzan" si se doblan sobre sí mismos.
      const [a, b] = j === i + 1 ? s[i]! : s[j]!;
      const [, c] = j === i + 1 ? s[j]! : s[i]!;
      if (onSegment(a, b, c) || onSegment(b, c, a)) return true;
    }
  }
  return false;
}

function ringsCross(a: readonly LatLng[], b: readonly LatLng[]): boolean {
  const sa = sides(a);
  const sb = sides(b);
  return sa.some((x) => sb.some((y) => segmentsIntersect(x, y)));
}

const OUTSIDE_MESSAGE =
  'queda fuera del área de servicio (Villagarzón, Mocoa y el corredor a Puerto Asís). Acerca los vértices.';

/** Problemas del polígono, en español; lista vacía si es válido. */
export function polygonIssues(polygon: PolygonRings): PolygonIssue[] {
  const rings = toEditable(polygon).map((ring) =>
    // Vértices repetidos seguidos no cuentan (un clic doble no debe invalidar el dibujo).
    ring.filter((p, i) => i === 0 || !same(p, ring[i - 1]!)),
  );
  if (rings.length === 0 || rings[0]!.length === 0) {
    return [{ code: 'empty', ring: 0, message: 'Dibuja el borde de la zona.' }];
  }
  const issues: PolygonIssue[] = [];
  const shapeOk: boolean[] = [];
  rings.forEach((ring, r) => {
    const name = ringName(r);
    if (ring.length < MIN_RING_VERTICES) {
      issues.push({
        code: 'too_few_vertices',
        ring: r,
        message: `${name} necesita al menos ${MIN_RING_VERTICES} vértices distintos.`,
      });
      shapeOk.push(false);
      return;
    }
    if (ring.some((p) => !isInServiceArea(p))) {
      issues.push({ code: 'outside_service_area', ring: r, message: `${name} ${OUTSIDE_MESSAGE}` });
    }
    if (ringSelfIntersects(ring)) {
      issues.push({
        code: 'self_intersection',
        ring: r,
        message: `${name} se cruza consigo mismo. Mueve los vértices para que los lados no se toquen.`,
      });
      shapeOk.push(false);
      return;
    }
    if (signedArea(ring) === 0) {
      issues.push({
        code: 'no_area',
        ring: r,
        message: `${name} no tiene área: sus vértices están en línea recta.`,
      });
      shapeOk.push(false);
      return;
    }
    shapeOk.push(true);
  });

  const [outer, ...holes] = rings;
  holes.forEach((hole, h) => {
    const r = h + 1;
    if (!shapeOk[0] || !shapeOk[r]) return;
    const name = ringName(r);
    if (ringsCross(outer!, hole)) {
      issues.push({
        code: 'rings_cross',
        ring: r,
        message: `${name} toca o cruza el borde exterior. Debe quedar completamente dentro.`,
      });
      return;
    }
    if (!pointInPolygon(hole[0]!, [outer!])) {
      issues.push({
        code: 'hole_outside',
        ring: r,
        message: `${name} queda fuera del borde exterior.`,
      });
      return;
    }
    holes.forEach((other, o) => {
      if (o === h || !shapeOk[o + 1]) return;
      if (o > h && ringsCross(hole, other)) {
        issues.push({
          code: 'rings_cross',
          ring: r,
          message: `${name} toca o cruza el hueco ${o + 1}.`,
        });
      } else if (pointInPolygon(hole[0]!, [other]) && !ringsCross(hole, other)) {
        issues.push({
          code: 'hole_in_hole',
          ring: r,
          message: `${name} está dentro del hueco ${o + 1}. Los huecos no pueden ir uno dentro de otro.`,
        });
      }
    });
  });
  return issues;
}

export function isPolygonValid(polygon: PolygonRings): boolean {
  return polygonIssues(polygon).length === 0;
}
