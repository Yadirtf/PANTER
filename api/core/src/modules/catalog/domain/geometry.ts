import { inBoundingBox, SERVICE_AREA, type LatLng, type PolygonRings } from '@panter/contracts';

/** Problema de validación de negocio, con la ruta del campo (mismo formato que los de Zod). */
export interface CatalogIssue {
  path: string;
  code: string;
  message: string;
}

/**
 * Máximo de vértices por polígono. Un barrio dibujado a mano tiene decenas; un límite exportado
 * de un SIG puede traer miles. Más de 5.000 suele ser un archivo sin simplificar que vuelve
 * lentas las consultas y pesado el croquis en el teléfono.
 */
export const AREA_MAX_VERTICES = 5000;

export const SERVICE_AREA_TEXT = 'Villagarzón, Mocoa y el corredor a Puerto Asís';

const sameVertex = (a: LatLng, b: LatLng) => a.lat === b.lat && a.lng === b.lng;

function distinctCount(ring: readonly LatLng[]): number {
  const out: LatLng[] = [];
  for (const p of ring) if (!out.some((q) => sameVertex(p, q))) out.push(p);
  return out.length;
}

/** Anillo abierto (sin repetir el primer vértice al final), como se devuelve en la API. */
export function openRing(ring: readonly LatLng[]): LatLng[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return ring.length > 1 && first && last && sameVertex(first, last)
    ? ring.slice(0, -1)
    : [...ring];
}

/**
 * Validación del polígono de un barrio o vereda antes de enviarlo a PostGIS (que además
 * comprueba `ST_IsValid`: bordes cruzados, huecos fuera del borde…):
 * - cada anillo tiene al menos 3 vértices distintos;
 * - todos los vértices están dentro de SERVICE_AREA (un rectángulo: si los vértices están
 *   dentro, todo el polígono lo está);
 * - no más de AREA_MAX_VERTICES vértices en total.
 */
export function areaPolygonIssues(polygon: PolygonRings, path = 'polygon'): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  if (polygon.length === 0) {
    return [{ path, code: 'empty_polygon', message: 'Dibuja el borde del barrio o vereda.' }];
  }
  let vertices = 0;
  polygon.forEach((ring, r) => {
    vertices += ring.length;
    if (distinctCount(ring) < 3) {
      issues.push({
        path: `${path}.${r}`,
        code: 'ring_too_small',
        message: 'Cada borde necesita al menos 3 puntos distintos.',
      });
    }
    const outside = ring.findIndex((p) => !inBoundingBox(p, SERVICE_AREA));
    if (outside >= 0) {
      issues.push({
        path: `${path}.${r}.${outside}`,
        code: 'outside_service_area',
        message: `El polígono debe quedar dentro del área de servicio (${SERVICE_AREA_TEXT}).`,
      });
    }
  });
  if (vertices > AREA_MAX_VERTICES) {
    issues.push({
      path,
      code: 'too_many_vertices',
      message: `El polígono tiene ${vertices} puntos; el máximo es ${AREA_MAX_VERTICES}. Simplifícalo antes de subirlo.`,
    });
  }
  return issues;
}
