import { describe, expect, it } from 'vitest';
import {
  AREA_IDS_MAX,
  AreasQuerySchema,
  AreaCreateBodySchema,
  AreaImportBodySchema,
  describeLocation,
  NearbyQuerySchema,
  PlaceCreateBodySchema,
  searchKey,
} from './catalog';
import { DETOUR_MIN_METERS, routeQuality } from './routes';

describe('searchKey', () => {
  it('ignora tildes, mayúsculas y signos', () => {
    expect(searchKey('Río Guineo')).toBe('rio guineo');
    expect(searchKey('  CASCADAS de Vica!! ')).toBe('cascadas de vica');
    expect(searchKey('Barrio San José (Etapa 2)')).toBe('barrio san jose etapa 2');
    expect(searchKey('Peñas Blancas')).toBe('penas blancas');
  });
});

describe('describeLocation', () => {
  it('arma "Barrio X · cerca de Y" con lo que haya', () => {
    expect(describeLocation({ name: 'Centro', kind: 'BARRIO' }, { name: 'Parque principal' })).toBe(
      'Barrio Centro · cerca de Parque principal',
    );
    expect(describeLocation({ name: 'La Castellana', kind: 'VEREDA' }, null)).toBe(
      'Vereda La Castellana',
    );
    expect(describeLocation(null, { name: 'Aeropuerto Cananguchal' })).toBe(
      'cerca de Aeropuerto Cananguchal',
    );
    expect(describeLocation(null, null)).toBeNull();
  });
});

describe('routeQuality (HU-307)', () => {
  const base = { originSnapMeters: 12.4, destinationSnapMeters: 3, alternatives: 3 };

  it('ruta razonable: no es inusual', () => {
    const q = routeQuality({ ...base, routeMeters: 4200, straightMeters: 3100 });
    expect(q).toEqual({
      originSnapMeters: 12,
      destinationSnapMeters: 3,
      detourRatio: 1.35,
      unusual: false,
      alternatives: 3,
    });
  });

  it('el caso de staging: 20,3 km para ~3 km en línea recta es inusual', () => {
    const q = routeQuality({ ...base, routeMeters: 20_300, straightMeters: 3_000 });
    expect(q.unusual).toBe(true);
    expect(q.detourRatio).toBeCloseTo(6.77, 2);
  });

  it('en distancias cortas no se marca aunque el factor sea alto', () => {
    expect(
      routeQuality({ ...base, routeMeters: DETOUR_MIN_METERS - 1, straightMeters: 100 }).unusual,
    ).toBe(false);
  });

  it('origen y destino iguales no dividen por cero', () => {
    expect(routeQuality({ ...base, routeMeters: 0, straightMeters: 0 }).detourRatio).toBe(1);
    expect(routeQuality({ ...base, routeMeters: 1500, straightMeters: 0 })).toMatchObject({
      detourRatio: 999,
      unusual: true,
    });
  });
});

describe('esquemas del catálogo', () => {
  const square = [
    [
      { lat: 1.03, lng: -76.62 },
      { lat: 1.03, lng: -76.61 },
      { lat: 1.04, lng: -76.61 },
    ],
  ];

  it('barrio: nombre y polígono', () => {
    expect(
      AreaCreateBodySchema.safeParse({ name: 'Centro', kind: 'BARRIO', polygon: square }).success,
    ).toBe(true);
    expect(
      AreaCreateBodySchema.safeParse({ name: 'C', kind: 'BARRIO', polygon: square }).success,
    ).toBe(false);
    expect(
      AreaCreateBodySchema.safeParse({ name: 'Centro', kind: 'COMUNA', polygon: square }).success,
    ).toBe(false);
  });

  it('importación: FeatureCollection, dryRun por defecto', () => {
    const parsed = AreaImportBodySchema.parse({
      geojson: { type: 'FeatureCollection', features: [{}] },
    });
    expect(parsed).toMatchObject({ dryRun: true, defaultKind: 'BARRIO' });
    expect(
      AreaImportBodySchema.safeParse({ geojson: { type: 'Feature', features: [] } }).success,
    ).toBe(false);
  });

  it('lugar: slug legible y ubicación', () => {
    const place = {
      slug: 'hospital-villagarzon',
      name: 'Hospital de Villagarzón',
      category: 'HEALTH',
      location: { lat: 1.03, lng: -76.616 },
    };
    expect(PlaceCreateBodySchema.parse(place)).toMatchObject({ verified: false });
    expect(
      PlaceCreateBodySchema.safeParse({ ...place, slug: 'Hospital Villagarzón' }).success,
    ).toBe(false);
  });

  it('cercanos: radio por defecto 300 m y máximo 2 km', () => {
    expect(NearbyQuerySchema.parse({ lat: '1.03', lng: '-76.61' })).toMatchObject({
      radiusMeters: 300,
      limit: 5,
    });
    expect(NearbyQuerySchema.safeParse({ lat: 1, lng: 1, radiusMeters: 5000 }).success).toBe(false);
  });
});

describe('AreasQuerySchema: ids e include (E15)', () => {
  const a = '6c1f8a2e-0b7d-4f3a-9c51-1a2b3c4d5e01';
  const b = '6c1f8a2e-0b7d-4f3a-9c51-1a2b3c4d5e02';
  it('ids separados por comas, sin repetir; include=polygon', () => {
    expect(AreasQuerySchema.parse({ ids: `${a}, ${b},${a}`, include: 'polygon' })).toMatchObject({
      ids: [a, b],
      include: 'polygon',
    });
    expect(AreasQuerySchema.parse({}).ids).toBeUndefined();
  });
  it('rechaza ids inválidos o más del máximo', () => {
    expect(AreasQuerySchema.safeParse({ ids: 'x' }).success).toBe(false);
    const many = Array.from(
      { length: AREA_IDS_MAX + 1 },
      (_, i) => `6c1f8a2e-0b7d-4f3a-9c51-${String(i).padStart(12, '0')}`,
    ).join(',');
    expect(AreasQuerySchema.safeParse({ ids: many }).success).toBe(false);
    expect(AreasQuerySchema.safeParse({ include: 'todo' }).success).toBe(false);
  });
});
