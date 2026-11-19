import { PLACES } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  easeInOutCubic,
  frameAt,
  headingArrowImage,
  interpolateHeading,
  interpolateLatLng,
  markersToFeatureCollection,
  normalizeHeading,
  planTransition,
  transitionMoves,
  type MapMarker,
} from './markers';

const CENTER = PLACES.VILLAGARZON_CENTER;
const linear = (t: number) => t;

const moto: MapMarker = {
  id: 'drv-1',
  position: CENTER,
  vehicleType: 'MOTOTAXI',
  status: 'AVAILABLE',
  heading: 90,
};
const taxi: MapMarker = {
  id: 'drv-2',
  position: { lat: 1.031, lng: -76.618 },
  vehicleType: 'TAXI',
  status: 'ON_TRIP',
};
const jeep: MapMarker = {
  id: 'drv-3',
  position: PLACES.AIRPORT_VGZ,
  vehicleType: 'JEEP_4X4',
  status: 'OFFLINE',
  heading: -45,
};

describe('GeoJSON de marcadores', () => {
  it('un Point por marcador con el ícono de map-style, estado y rumbo', () => {
    const fc = markersToFeatureCollection([moto, taxi, jeep]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(3);
    expect(fc.features[0]).toEqual({
      type: 'Feature',
      id: 'drv-1',
      geometry: { type: 'Point', coordinates: [CENTER.lng, CENTER.lat] },
      properties: {
        id: 'drv-1',
        icon: 'vehicle-mototaxi',
        status: 'AVAILABLE',
        heading: 90,
        hasHeading: true,
      },
    });
    expect(fc.features[1]!.properties).toMatchObject({
      icon: 'vehicle-taxi',
      heading: 0,
      hasHeading: false,
    });
    expect(fc.features[2]!.properties).toMatchObject({
      icon: 'vehicle-4x4',
      status: 'OFFLINE',
      heading: 315,
    });
  });

  it('un id repetido deja solo la última posición', () => {
    const moved = { ...moto, position: { lat: 1.03, lng: -76.61 } };
    const fc = markersToFeatureCollection([moto, taxi, moved]);
    expect(fc.features.map((f) => f.id)).toEqual(['drv-2', 'drv-1']);
    expect(fc.features[1]!.geometry.coordinates).toEqual([-76.61, 1.03]);
  });

  it('lista vacía → colección vacía (la flota de HU-504 aún no llega)', () => {
    expect(markersToFeatureCollection([])).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('decenas de conductores en una sola colección', () => {
    const fleet = Array.from({ length: 60 }, (_, i) => ({
      ...moto,
      id: `drv-${i}`,
      position: { lat: CENTER.lat + i * 1e-4, lng: CENTER.lng },
    }));
    expect(markersToFeatureCollection(fleet).features).toHaveLength(60);
  });
});

describe('interpolación', () => {
  it('posición lineal entre dos puntos', () => {
    const a = { lat: 1.0, lng: -76.6 };
    const b = { lat: 1.02, lng: -76.62 };
    expect(interpolateLatLng(a, b, 0)).toEqual(a);
    expect(interpolateLatLng(a, b, 1)).toEqual(b);
    const mid = interpolateLatLng(a, b, 0.5);
    expect(mid.lat).toBeCloseTo(1.01, 10);
    expect(mid.lng).toBeCloseTo(-76.61, 10);
  });

  it('rumbo por el giro más corto, también al cruzar el norte', () => {
    expect(interpolateHeading(350, 10, 0.5)).toBeCloseTo(0, 10);
    expect(interpolateHeading(10, 350, 0.25)).toBeCloseTo(5, 10);
    expect(interpolateHeading(0, 90, 0.5)).toBeCloseTo(45, 10);
    expect(interpolateHeading(270, 90, 0.5)).toBeCloseTo(180, 10);
    expect(normalizeHeading(-90)).toBe(270);
    expect(normalizeHeading(720)).toBe(0);
    expect(Object.is(normalizeHeading(-360), 0)).toBe(true);
  });

  it('el suavizado empieza en 0, pasa por 0,5 y termina en 1', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
  });

  it('anima de la posición dibujada a la nueva y termina exactamente en el destino', () => {
    const next = { ...moto, position: { lat: CENTER.lat + 0.001, lng: CENTER.lng }, heading: 180 };
    const transition = planTransition([moto], [next]);
    expect(transitionMoves(transition)).toBe(true);
    expect(frameAt(transition, 0, linear)[0]).toEqual(moto);
    const half = frameAt(transition, 0.5, linear)[0]!;
    expect(half.position.lat).toBeCloseTo(CENTER.lat + 0.0005, 10);
    expect(half.heading).toBeCloseTo(135, 10);
    expect(frameAt(transition, 1, linear)[0]).toBe(next);
    expect(frameAt(transition, 3, linear)[0]).toBe(next);
  });

  it('los nuevos aparecen en su destino, los que salen desaparecen y los saltos largos no se animan', () => {
    const farAway = { ...taxi, position: PLACES.MOCOA_CENTER }; // ~14 km: sin animación
    const transition = planTransition([moto, taxi], [farAway, jeep]);
    const frame = frameAt(transition, 0.5, linear);
    expect(frame.map((m) => m.id)).toEqual(['drv-2', 'drv-3']);
    expect(frame[0]).toBe(farAway);
    expect(frame[1]).toBe(jeep);
    expect(transitionMoves(transition)).toBe(false);
  });

  it('sin rumbo en alguno de los extremos se usa el del destino', () => {
    const next = { ...taxi, position: { lat: 1.032, lng: -76.618 }, heading: 30 };
    const half = frameAt(planTransition([taxi], [next]), 0.5, linear)[0]!;
    expect(half.heading).toBe(30);
    expect(half.status).toBe('ON_TRIP');
  });

  it('sin movimiento no hay nada que animar', () => {
    expect(transitionMoves(planTransition([moto, taxi], [{ ...moto }, { ...taxi }]))).toBe(false);
  });
});

describe('flecha de rumbo', () => {
  it('imagen RGBA cuadrada lista para addImage', () => {
    const image = headingArrowImage(2);
    expect(image.width).toBe(28);
    expect(image.height).toBe(28);
    expect(image.data).toHaveLength(28 * 28 * 4);
    // Punta arriba al centro opaca, esquinas transparentes.
    const alpha = (x: number, y: number) => image.data[(y * image.width + x) * 4 + 3];
    expect(alpha(14, 6)).toBe(255);
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(27, 0)).toBe(0);
  });
});
