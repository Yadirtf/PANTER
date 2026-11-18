import { describe, expect, it } from 'vitest';
import {
  decodePolyline,
  encodePolyline,
  haversineMeters,
  pathLengthMeters,
  pointInPolygon,
  routeProgress,
  type LatLng,
} from './geo';
import { isInServiceArea, PLACES } from './places';

const near = (actual: number, expected: number, tolerance: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);

describe('haversineMeters', () => {
  it('es 0 en el mismo punto y simétrica', () => {
    const a = PLACES.VILLAGARZON_CENTER;
    const b = PLACES.AIRPORT_VGZ;
    expect(haversineMeters(a, a)).toBe(0);
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it('un grado de latitud mide ~111,2 km', () => {
    near(haversineMeters({ lat: 1, lng: -76.6 }, { lat: 2, lng: -76.6 }), 111_195, 5);
  });

  it('centro de Villagarzón → aeropuerto Cananguchal ≈ 5,7 km en línea recta', () => {
    near(haversineMeters(PLACES.VILLAGARZON_CENTER, PLACES.AIRPORT_VGZ), 5_710, 100);
  });

  it('Villagarzón → Mocoa ≈ 14 km en línea recta', () => {
    near(haversineMeters(PLACES.VILLAGARZON_CENTER, PLACES.MOCOA_CENTER), 13_830, 300);
  });
});

describe('polilíneas', () => {
  it('decodifica el ejemplo de referencia de Google', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });

  it('codificar y decodificar es ida y vuelta (coordenadas del Putumayo)', () => {
    const path: LatLng[] = [
      PLACES.VILLAGARZON_CENTER,
      { lat: 1.0011, lng: -76.6102 },
      PLACES.AIRPORT_VGZ,
    ];
    expect(decodePolyline(encodePolyline(path))).toEqual(path);
    expect(decodePolyline('')).toEqual([]);
  });

  it('rechaza polilíneas truncadas o con caracteres inválidos', () => {
    expect(() => decodePolyline('_p~iF~ps|U_')).toThrow(RangeError);
    expect(() => decodePolyline('_p~iF ')).toThrow(RangeError);
  });
});

describe('routeProgress', () => {
  // Ruta en "L": centro → sur → aeropuerto.
  const route: LatLng[] = [
    { lat: 1.0295, lng: -76.6165 },
    { lat: 1.0, lng: -76.6165 },
    { lat: 1.0, lng: -76.6053 },
  ];
  const total = pathLengthMeters(route);

  it('al inicio queda toda la ruta y al final nada', () => {
    near(routeProgress(route, route[0]!).remainingMeters, total, 0.5);
    near(routeProgress(route, route[2]!).remainingMeters, 0, 0.5);
  });

  it('en la mitad del primer tramo queda la mitad de él más el segundo', () => {
    const mid = { lat: (1.0295 + 1.0) / 2, lng: -76.6165 };
    const p = routeProgress(route, mid);
    near(p.remainingMeters, total - haversineMeters(route[0]!, route[1]!) / 2, 2);
    expect(p.segmentIndex).toBe(0);
    near(p.offRouteMeters, 0, 0.5);
  });

  it('mide el desvío perpendicular (umbral de 50 m de §6.2)', () => {
    // ~80 m al oriente del primer tramo.
    const p = routeProgress(route, { lat: 1.015, lng: -76.6158 });
    near(p.offRouteMeters, 78, 3);
    expect(p.offRouteMeters).toBeGreaterThan(50);
  });

  it('una ruta de un punto devuelve la distancia a él', () => {
    expect(routeProgress([PLACES.AIRPORT_VGZ], PLACES.AIRPORT_VGZ).offRouteMeters).toBe(0);
    expect(() => routeProgress([], PLACES.AIRPORT_VGZ)).toThrow();
  });
});

describe('pointInPolygon', () => {
  const box = (s: number, w: number, n: number, e: number): LatLng[] => [
    { lat: s, lng: w },
    { lat: s, lng: e },
    { lat: n, lng: e },
    { lat: n, lng: w },
  ];
  const airport = [box(0.972, -76.612, 0.986, -76.598)];
  const peripheral = [box(1.0, -76.65, 1.06, -76.585), box(1.02, -76.628, 1.04, -76.605)];

  it('el aeropuerto está dentro de su geocerca y el centro no', () => {
    expect(pointInPolygon(PLACES.AIRPORT_VGZ, airport)).toBe(true);
    expect(pointInPolygon(PLACES.VILLAGARZON_CENTER, airport)).toBe(false);
  });

  it('respeta los huecos: el centro no es periferia, sus alrededores sí', () => {
    expect(pointInPolygon(PLACES.VILLAGARZON_CENTER, peripheral)).toBe(false);
    expect(pointInPolygon({ lat: 1.05, lng: -76.6 }, peripheral)).toBe(true);
    expect(pointInPolygon({ lat: 1.2, lng: -76.6 }, peripheral)).toBe(false);
  });

  it('acepta anillos cerrados', () => {
    const ring = box(0.972, -76.612, 0.986, -76.598);
    expect(pointInPolygon(PLACES.AIRPORT_VGZ, [[...ring, ring[0]!]])).toBe(true);
  });
});

describe('área de servicio', () => {
  it('incluye Villagarzón, Mocoa y Puerto Asís, y excluye Bogotá', () => {
    for (const p of Object.values(PLACES)) expect(isInServiceArea(p)).toBe(true);
    expect(isInServiceArea({ lat: 4.711, lng: -74.0721 })).toBe(false);
  });
});
