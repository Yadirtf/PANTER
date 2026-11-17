import { Role } from '@panter/contracts';
import { getTableConfig, pgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { buildDb } from '../src/composition/db';
import { isValidGeoPoint } from '../src/shared/domain/geo-point';
import {
  geographyPoint,
  parseEwkbPoint,
  parseGeoPoint,
  toEwkt,
} from '../src/shared/infrastructure/db/geography';
import { rowsOf } from '../src/shared/infrastructure/db/rows';
import { roleEnum, userRoles, users } from '../src/shared/infrastructure/db/schema';

// Parque principal de Villagarzón, aprox.
const VILLAGARZON = { lng: -76.6167, lat: 1.0294 };

/** Construye EWKB hexadecimal de un POINT, como lo devolvería PostGIS. */
function ewkb(
  lng: number,
  lat: number,
  { littleEndian = true, srid = 4326 as number | null, z = null as number | null } = {},
): string {
  const size = 1 + 4 + (srid === null ? 0 : 4) + 16 + (z === null ? 0 : 8);
  const view = new DataView(new ArrayBuffer(size));
  let type = 1;
  if (srid !== null) type |= 0x20000000;
  if (z !== null) type |= 0x80000000;
  view.setUint8(0, littleEndian ? 1 : 0);
  view.setUint32(1, type >>> 0, littleEndian);
  let offset = 5;
  if (srid !== null) {
    view.setUint32(offset, srid, littleEndian);
    offset += 4;
  }
  view.setFloat64(offset, lng, littleEndian);
  view.setFloat64(offset + 8, lat, littleEndian);
  if (z !== null) view.setFloat64(offset + 16, z, littleEndian);
  return [...new Uint8Array(view.buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('geography(Point,4326)', () => {
  it('escribe EWKT con la longitud primero', () => {
    expect(toEwkt(VILLAGARZON)).toBe('SRID=4326;POINT(-76.6167 1.0294)');
  });

  it('rechaza coordenadas fuera de rango o no finitas', () => {
    expect(() => toEwkt({ lng: -200, lat: 0 })).toThrow(RangeError);
    expect(() => toEwkt({ lng: 0, lat: 91 })).toThrow(RangeError);
    expect(() => toEwkt({ lng: Number.NaN, lat: 0 })).toThrow(RangeError);
    expect(isValidGeoPoint({ lng: 180, lat: -90 })).toBe(true);
  });

  it('decodifica el EWKB hexadecimal real de PostGIS', () => {
    // SELECT 'SRID=4326;POINT(-76.6167 1.0294)'::geography;
    expect(parseEwkbPoint('0101000020E61000005DDC4603782753C0D50968226C78F03F')).toEqual(
      VILLAGARZON,
    );
    expect(parseEwkbPoint('0101000020e61000005ddc4603782753c0d50968226c78f03f')).toEqual(
      VILLAGARZON,
    );
  });

  it('acepta big endian, WKB sin SRID y puntos con Z', () => {
    expect(parseEwkbPoint(ewkb(1.5, -2.25, { littleEndian: false }))).toEqual({
      lng: 1.5,
      lat: -2.25,
    });
    expect(parseEwkbPoint(ewkb(10, 20, { srid: null }))).toEqual({ lng: 10, lat: 20 });
    expect(parseEwkbPoint(ewkb(10, 20, { z: 300 }))).toEqual({ lng: 10, lat: 20 });
  });

  it('rechaza valores que no son un POINT 4326', () => {
    expect(() => parseEwkbPoint('zz')).toThrow(TypeError);
    expect(() => parseEwkbPoint('0101')).toThrow(TypeError);
    expect(() => parseEwkbPoint(ewkb(1, 2, { srid: 3857 }))).toThrow(/SRID 3857/);
    // LINESTRING (tipo 2)
    expect(() => parseEwkbPoint(ewkb(1, 2).replace(/^0101/, '0102'))).toThrow(/POINT/);
    expect(() => parseEwkbPoint(ewkb(Number.NaN, Number.NaN))).toThrow(/EMPTY/);
  });

  it('lee GeoJSON de ST_AsGeoJSON como texto u objeto', () => {
    expect(parseGeoPoint('{"type":"Point","coordinates":[-76.6167,1.0294]}')).toEqual(VILLAGARZON);
    expect(parseGeoPoint({ type: 'Point', coordinates: [1, 2] })).toEqual({ lng: 1, lat: 2 });
    expect(() => parseGeoPoint({ type: 'LineString', coordinates: [] })).toThrow(TypeError);
    expect(() => parseGeoPoint(42)).toThrow(TypeError);
  });

  it('el customType declara el tipo SQL y hace ida y vuelta', () => {
    const places = pgTable('places', { location: geographyPoint('location').notNull() });
    const column = places.location;
    expect(column.getSQLType()).toBe('geography(Point,4326)');
    expect(column.mapToDriverValue(VILLAGARZON)).toBe('SRID=4326;POINT(-76.6167 1.0294)');
    expect(column.mapFromDriverValue(ewkb(VILLAGARZON.lng, VILLAGARZON.lat))).toEqual(VILLAGARZON);
  });
});

describe('esquema', () => {
  it('el enum role usa los valores de @panter/contracts', () => {
    expect(roleEnum.enumValues).toEqual(Object.values(Role));
  });

  it('users y user_roles siguen la especificación §5.1', () => {
    const u = getTableConfig(users);
    expect(u.name).toBe('users');
    expect(u.columns.map((c) => c.name).sort()).toEqual(
      ['created_at', 'email', 'full_name', 'id', 'phone', 'status'].sort(),
    );
    expect(u.indexes.map((i) => i.config.name)).toContain('users_email_lower_key');

    const r = getTableConfig(userRoles);
    expect(r.columns.map((c) => c.name).sort()).toEqual(
      ['granted_at', 'granted_by', 'role', 'user_id'].sort(),
    );
    expect(r.primaryKeys[0]?.columns.map((c) => c.name)).toEqual(['user_id', 'role']);
  });
});

describe('cliente por request', () => {
  it('falla con un mensaje claro si falta DATABASE_URL', () => {
    expect(() => buildDb({})).toThrow(/DATABASE_URL/);
  });

  it('crear el cliente no abre conexiones', () => {
    const db = buildDb({ DATABASE_URL: 'postgresql://u:p@ep-test.neon.tech/panter' });
    expect(typeof db.select).toBe('function');
  });
});

describe('rowsOf', () => {
  it('acepta el resultado de neon-http ({ rows }) y el de postgres-js (arreglo)', () => {
    expect(rowsOf([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(rowsOf({ rows: [{ a: 2 }], fields: [] })).toEqual([{ a: 2 }]);
    expect(rowsOf({})).toEqual([]);
    expect(rowsOf(null)).toEqual([]);
  });
});
