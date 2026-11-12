import { customType } from 'drizzle-orm/pg-core';
import { isValidGeoPoint, type GeoPoint } from '../../domain/geo-point';

/**
 * Columna PostGIS `geography(Point,4326)` mapeada a `{ lng, lat }`.
 *
 * Escritura: se envía EWKT como texto, `SRID=4326;POINT(lng lat)` (primero la longitud).
 * PostgreSQL convierte el literal al tipo de la columna, así que no hace falta `ST_GeogFromText`.
 *
 * Lectura: PostGIS devuelve `geography` en su salida de texto por defecto, EWKB en hexadecimal
 * (p. ej. `0101000020E6100000…`). Los drivers (neon-http, postgres-js) no conocen el OID del
 * tipo y entregan ese texto tal cual; `parseEwkbPoint` lo decodifica sin ir a la base de datos.
 * Para consultas a medida también se acepta GeoJSON (`ST_AsGeoJSON(col)`), ver `parseGeoPoint`.
 */
export const geographyPoint = customType<{ data: GeoPoint; driverData: string }>({
  dataType() {
    return 'geography(Point,4326)';
  },
  toDriver(value) {
    return toEwkt(value);
  },
  fromDriver(value) {
    return parseGeoPoint(value);
  },
});

export function toEwkt(point: GeoPoint): string {
  if (!isValidGeoPoint(point)) {
    throw new RangeError(`Punto fuera de rango: lng=${point.lng}, lat=${point.lat}`);
  }
  return `SRID=4326;POINT(${point.lng} ${point.lat})`;
}

/** Acepta EWKB hexadecimal (salida por defecto de PostGIS) o GeoJSON (`ST_AsGeoJSON`). */
export function parseGeoPoint(value: unknown): GeoPoint {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.startsWith('{')) return parseGeoJsonPoint(JSON.parse(text));
    return parseEwkbPoint(text);
  }
  if (typeof value === 'object' && value !== null) return parseGeoJsonPoint(value);
  throw new TypeError(`Valor geography no reconocido: ${String(value)}`);
}

const WKB_POINT = 1;
const EWKB_SRID = 0x20000000;

/**
 * Decodifica un punto en (E)WKB hexadecimal:
 * `[orden 1 B][tipo uint32 + banderas][SRID uint32 si hay bandera][x float64][y float64]…`.
 * Acepta little y big endian; ignora Z/M si vienen. Exige SRID 4326 si el valor lo trae.
 */
export function parseEwkbPoint(hex: string): GeoPoint {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new TypeError('EWKB inválido: no es hexadecimal');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  if (bytes.length < 21) throw new TypeError('EWKB inválido: demasiado corto');

  const view = new DataView(bytes.buffer);
  const littleEndian = bytes[0] === 1;
  if (!littleEndian && bytes[0] !== 0) throw new TypeError('EWKB inválido: orden de bytes');

  const rawType = view.getUint32(1, littleEndian);
  // ISO WKB codifica Z/M sumando 1000/2000/3000 al tipo; EWKB usa las banderas altas.
  const baseType = (rawType & 0xffff) % 1000;
  if (baseType !== WKB_POINT) {
    throw new TypeError(`EWKB inválido: se esperaba POINT y llegó el tipo ${baseType}`);
  }
  let offset = 5;
  if (rawType & EWKB_SRID) {
    const srid = view.getUint32(offset, littleEndian);
    if (srid !== 4326) throw new TypeError(`SRID ${srid} no soportado; se esperaba 4326`);
    offset += 4;
  }
  if (bytes.length < offset + 16) throw new TypeError('EWKB inválido: faltan coordenadas');

  const lng = view.getFloat64(offset, littleEndian);
  const lat = view.getFloat64(offset + 8, littleEndian);
  if (Number.isNaN(lng) || Number.isNaN(lat)) throw new TypeError('POINT EMPTY no soportado');
  return { lng, lat };
}

function parseGeoJsonPoint(value: unknown): GeoPoint {
  const geo = value as { type?: unknown; coordinates?: unknown };
  const coords = geo.coordinates;
  if (
    geo.type !== 'Point' ||
    !Array.isArray(coords) ||
    typeof coords[0] !== 'number' ||
    typeof coords[1] !== 'number'
  ) {
    throw new TypeError('GeoJSON inválido: se esperaba un Point');
  }
  return { lng: coords[0], lat: coords[1] };
}
