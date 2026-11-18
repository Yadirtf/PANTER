import type { LatLng, PolygonRings } from '@panter/contracts';
import { customType } from 'drizzle-orm/pg-core';

/**
 * Columna PostGIS `geography(Polygon,4326)` mapeada a anillos `{ lat, lng }[][]` (el primero
 * es el borde exterior; los demás, huecos). Mismo enfoque que `geographyPoint`:
 * - escritura: EWKT `SRID=4326;POLYGON((lng lat, …), (…))`, cerrando cada anillo;
 * - lectura: EWKB hexadecimal (salida por defecto de PostGIS) o GeoJSON (`ST_AsGeoJSON`).
 * Las consultas espaciales (p. ej. `ST_Covers(area, punto)`) se hacen en SQL con el índice GIST.
 */
export const geographyPolygon = customType<{ data: PolygonRings; driverData: string }>({
  dataType() {
    return 'geography(Polygon,4326)';
  },
  toDriver(value) {
    return polygonToEwkt(value);
  },
  fromDriver(value) {
    return parsePolygon(value);
  },
});

function assertValid(p: LatLng): void {
  if (
    !Number.isFinite(p.lat) ||
    !Number.isFinite(p.lng) ||
    Math.abs(p.lat) > 90 ||
    Math.abs(p.lng) > 180
  ) {
    throw new RangeError(`Vértice fuera de rango: lat=${p.lat}, lng=${p.lng}`);
  }
}

function closeRing(ring: readonly LatLng[]): LatLng[] {
  if (ring.length < 3) throw new RangeError('Un anillo necesita al menos 3 vértices');
  ring.forEach(assertValid);
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first.lat === last.lat && first.lng === last.lng ? [...ring] : [...ring, first];
}

export function polygonToEwkt(polygon: PolygonRings): string {
  if (polygon.length === 0) throw new RangeError('El polígono no tiene anillos');
  const rings = polygon.map(
    (ring) =>
      `(${closeRing(ring)
        .map((p) => `${p.lng} ${p.lat}`)
        .join(', ')})`,
  );
  return `SRID=4326;POLYGON(${rings.join(', ')})`;
}

/** Quita el vértice de cierre para devolver anillos abiertos, como se escriben. */
function openRing(ring: LatLng[]): LatLng[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first && last && ring.length > 1 && first.lat === last.lat && first.lng === last.lng
    ? ring.slice(0, -1)
    : ring;
}

export function parsePolygon(value: unknown): LatLng[][] {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.startsWith('{')) return parseGeoJsonPolygon(JSON.parse(text));
    return parseEwkbPolygon(text);
  }
  if (typeof value === 'object' && value !== null) return parseGeoJsonPolygon(value);
  throw new TypeError(`Valor geography no reconocido: ${String(value)}`);
}

const WKB_POLYGON = 3;
const EWKB_SRID = 0x20000000;
const EWKB_Z = 0x80000000;
const EWKB_M = 0x40000000;

/** Decodifica un POLYGON en (E)WKB hexadecimal (little o big endian; ignora Z/M). */
export function parseEwkbPolygon(hex: string): LatLng[][] {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new TypeError('EWKB inválido: no es hexadecimal');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  if (bytes.length < 9) throw new TypeError('EWKB inválido: demasiado corto');
  const view = new DataView(bytes.buffer);
  const le = bytes[0] === 1;
  if (!le && bytes[0] !== 0) throw new TypeError('EWKB inválido: orden de bytes');

  const rawType = view.getUint32(1, le);
  const iso = rawType & 0xffff;
  const baseType = iso % 1000;
  if (baseType !== WKB_POLYGON) {
    throw new TypeError(`EWKB inválido: se esperaba POLYGON y llegó el tipo ${baseType}`);
  }
  const hasZ = Boolean(rawType & EWKB_Z) || [1, 3].includes(Math.floor(iso / 1000));
  const hasM = Boolean(rawType & EWKB_M) || [2, 3].includes(Math.floor(iso / 1000));
  const stride = 16 + (hasZ ? 8 : 0) + (hasM ? 8 : 0);

  let offset = 5;
  if (rawType & EWKB_SRID) {
    const srid = view.getUint32(offset, le);
    if (srid !== 4326) throw new TypeError(`SRID ${srid} no soportado; se esperaba 4326`);
    offset += 4;
  }
  const need = (n: number) => {
    if (offset + n > bytes.length) throw new TypeError('EWKB inválido: datos incompletos');
  };
  need(4);
  const ringCount = view.getUint32(offset, le);
  offset += 4;
  const rings: LatLng[][] = [];
  for (let r = 0; r < ringCount; r++) {
    need(4);
    const n = view.getUint32(offset, le);
    offset += 4;
    need(n * stride);
    const ring: LatLng[] = [];
    for (let i = 0; i < n; i++) {
      const lng = view.getFloat64(offset, le);
      const lat = view.getFloat64(offset + 8, le);
      ring.push({ lat, lng });
      offset += stride;
    }
    rings.push(openRing(ring));
  }
  if (rings.length === 0) throw new TypeError('POLYGON EMPTY no soportado');
  return rings;
}

function parseGeoJsonPolygon(value: unknown): LatLng[][] {
  const geo = value as { type?: unknown; coordinates?: unknown };
  if (geo.type !== 'Polygon' || !Array.isArray(geo.coordinates)) {
    throw new TypeError('GeoJSON inválido: se esperaba un Polygon');
  }
  return (geo.coordinates as unknown[]).map((ring) => {
    if (!Array.isArray(ring)) throw new TypeError('GeoJSON inválido: anillo');
    return openRing(
      ring.map((c) => {
        if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') {
          throw new TypeError('GeoJSON inválido: coordenada');
        }
        return { lat: c[1], lng: c[0] };
      }),
    );
  });
}
