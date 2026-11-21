import { describe, expect, it } from 'vitest';
import { placeIcon } from './place-icon';
import {
  areaFeature,
  areaFramePoints,
  areaLabel,
  isInsideArea,
  placeDestinationPoint,
  resolveCatalogPoi,
} from './selection';
import { CENTRO_CENTER, makeArea, makePlace, square } from './test-helpers';

describe('destino desde un lugar', () => {
  it('usa el punto de recogida si existe', () => {
    const pickupPoint = { lat: 0.9801, lng: -76.6047 };
    expect(placeDestinationPoint(makePlace({ pickupPoint }))).toEqual(pickupPoint);
  });

  it('sin punto de recogida, la ubicación del lugar', () => {
    expect(placeDestinationPoint(makePlace())).toEqual({ lat: 0.9789, lng: -76.6053 });
  });
});

describe('croquis del barrio', () => {
  const area = makeArea();

  it('punto dentro y fuera (pointInPolygon de contracts)', () => {
    expect(isInsideArea(CENTRO_CENTER, area)).toBe(true);
    expect(isInsideArea({ lat: 1.031, lng: -76.6155 }, area)).toBe(true);
    expect(isInsideArea({ lat: 1.035, lng: -76.6165 }, area)).toBe(false);
  });

  it('un hueco del polígono cuenta como fuera', () => {
    const withHole = makeArea({ polygon: [square(CENTRO_CENTER), square(CENTRO_CENTER, 0.0005)] });
    expect(isInsideArea(CENTRO_CENTER, withHole)).toBe(false);
    expect(isInsideArea({ lat: 1.031, lng: -76.6155 }, withHole)).toBe(true);
  });

  it('GeoJSON con anillos cerrados en [lng, lat]', () => {
    const ring = areaFeature(area).geometry.coordinates[0]!;
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    expect(ring[0]).toEqual([-76.6185, 1.0275]);
    const closed = makeArea({ polygon: [[...square(CENTRO_CENTER), square(CENTRO_CENTER)[0]!]] });
    expect(areaFeature(closed).geometry.coordinates[0]).toHaveLength(5);
  });

  it('encuadre con el anillo exterior y nombre con su tipo', () => {
    expect(areaFramePoints(area)).toHaveLength(4);
    expect(areaLabel(area)).toBe('Barrio Centro');
    expect(areaLabel({ name: 'Alto Guineo', kind: 'VEREDA' })).toBe('Vereda Alto Guineo');
  });
});

describe('íconos de los lugares', () => {
  it('de map-style por slug o categoría; si no, Material Icons', () => {
    expect(placeIcon({ slug: 'rio-guineo', category: 'TOURISM' })).toEqual({
      kind: 'map',
      id: 'place-river',
    });
    expect(placeIcon({ slug: 'aeropuerto-cananguchal', category: 'AIRPORT' })).toEqual({
      kind: 'map',
      id: 'place-airport',
    });
    expect(placeIcon({ slug: 'termales-x', category: 'TOURISM' })).toEqual({
      kind: 'map',
      id: 'place-nature',
    });
    expect(placeIcon({ slug: 'hospital', category: 'HEALTH' })).toEqual({
      kind: 'material',
      name: 'local-hospital',
    });
  });
});

describe('punto clave del mapa → lugar del catálogo', () => {
  const tapped = {
    name: 'Aeropuerto Cananguchal',
    point: { lat: 0.9789, lng: -76.6053 },
    kind: null,
    placeSlug: 'aeropuerto-cananguchal',
  };

  it('usa el punto de recogida y el nombre del catálogo', () => {
    const pickupPoint = { lat: 0.9801, lng: -76.6047 };
    const place = makePlace({ name: 'Aeropuerto Cananguchal (VGZ)', pickupPoint });
    expect(resolveCatalogPoi(tapped, [place])).toEqual({
      ...tapped,
      name: 'Aeropuerto Cananguchal (VGZ)',
      point: pickupPoint,
    });
  });

  it('sin el lugar en el catálogo (o desactivado), o sin slug, queda igual', () => {
    expect(resolveCatalogPoi(tapped, [])).toBe(tapped);
    expect(resolveCatalogPoi(tapped, [makePlace({ active: false })])).toBe(tapped);
    const osm = { ...tapped, placeSlug: null };
    expect(resolveCatalogPoi(osm, [makePlace()])).toBe(osm);
  });
});
