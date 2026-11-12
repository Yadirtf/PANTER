/**
 * Punto geográfico WGS 84 (SRID 4326). Tipo propio del dominio: no depende de Drizzle ni de
 * PostGIS. Las columnas `geography(Point,4326)` se leen y escriben con este tipo.
 */
export interface GeoPoint {
  /** Longitud en grados, [-180, 180]. */
  lng: number;
  /** Latitud en grados, [-90, 90]. */
  lat: number;
}

export function isValidGeoPoint(point: GeoPoint): boolean {
  return (
    Number.isFinite(point.lng) &&
    Number.isFinite(point.lat) &&
    point.lng >= -180 &&
    point.lng <= 180 &&
    point.lat >= -90 &&
    point.lat <= 90
  );
}
