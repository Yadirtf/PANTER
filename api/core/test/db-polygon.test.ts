import { describe, expect, it } from 'vitest';
import {
  parseEwkbPolygon,
  parsePolygon,
  polygonToEwkt,
} from '../src/shared/infrastructure/db/geography-polygon';

const square = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 1 },
  { lat: 1, lng: 1 },
];

/** EWKB little endian de un POLYGON con SRID 4326, para probar sin base de datos. */
function ewkbPolygon(rings: { lat: number; lng: number }[][]): string {
  const parts: number[] = [1];
  const u32 = (n: number) => {
    const b = new DataView(new ArrayBuffer(4));
    b.setUint32(0, n, true);
    parts.push(...new Uint8Array(b.buffer));
  };
  const f64 = (n: number) => {
    const b = new DataView(new ArrayBuffer(8));
    b.setFloat64(0, n, true);
    parts.push(...new Uint8Array(b.buffer));
  };
  u32(3 | 0x20000000);
  u32(4326);
  u32(rings.length);
  for (const ring of rings) {
    const closed = [...ring, ring[0]!];
    u32(closed.length);
    for (const p of closed) {
      f64(p.lng);
      f64(p.lat);
    }
  }
  return parts.map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('geography(Polygon,4326)', () => {
  it('escribe EWKT cerrando los anillos y con la longitud primero', () => {
    expect(polygonToEwkt([square])).toBe('SRID=4326;POLYGON((0 0, 1 0, 1 1, 0 0))');
  });

  it('valida anillos y vértices', () => {
    expect(() => polygonToEwkt([])).toThrow(RangeError);
    expect(() => polygonToEwkt([square.slice(0, 2)])).toThrow(RangeError);
    expect(() => polygonToEwkt([[...square.slice(0, 2), { lat: 95, lng: 0 }]])).toThrow(RangeError);
  });

  it('lee EWKB con huecos y devuelve anillos abiertos', () => {
    const hole = [
      { lat: 0.2, lng: 0.2 },
      { lat: 0.2, lng: 0.4 },
      { lat: 0.4, lng: 0.4 },
    ];
    expect(parseEwkbPolygon(ewkbPolygon([square, hole]))).toEqual([square, hole]);
  });

  it('lee GeoJSON de ST_AsGeoJSON', () => {
    const geo = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    };
    expect(parsePolygon(JSON.stringify(geo))).toEqual([square]);
    expect(parsePolygon(geo)).toEqual([square]);
  });

  it('rechaza valores que no son un POLYGON 4326', () => {
    expect(() => parseEwkbPolygon('zz')).toThrow(TypeError);
    expect(() => parseEwkbPolygon('0101000020E6100000000000000000F03F000000000000F03F')).toThrow(
      /POLYGON/,
    );
    expect(() => parsePolygon({ type: 'Point', coordinates: [0, 0] })).toThrow(TypeError);
    expect(() => parsePolygon(42)).toThrow(TypeError);
  });
});
