import type { BoundingBox, LatLng } from './geo';
import { inBoundingBox } from './geo';

/**
 * Área de servicio y lugares de referencia (§6.1). Cubre Villagarzón, Mocoa y el corredor a
 * Puerto Asís. Es la misma caja del extracto de mapa .pmtiles (HU-301).
 */
export const SERVICE_AREA: BoundingBox = { west: -77.05, south: 0.4, east: -76.3, north: 1.3 };

export function isInServiceArea(point: LatLng): boolean {
  return inBoundingBox(point, SERVICE_AREA);
}

/** Zona horaria de la operación: Colombia no tiene horario de verano (UTC−5 todo el año). */
export const OPERATION_TIME_ZONE = 'America/Bogota';
export const OPERATION_UTC_OFFSET_MINUTES = -5 * 60;

/**
 * Lugares clave con coordenadas verificadas de forma aproximada. Los puntos turísticos y las
 * geocercas se ajustan en la prueba de campo (HU-1102) y en OpenStreetMap.
 */
export const PLACES = {
  VILLAGARZON_CENTER: { lat: 1.0295, lng: -76.6165 },
  AIRPORT_VGZ: { lat: 0.9789, lng: -76.6053 },
  MOCOA_CENTER: { lat: 1.1494, lng: -76.6467 },
  PUERTO_ASIS_CENTER: { lat: 0.5052, lng: -76.4958 },
} as const satisfies Record<string, LatLng>;
