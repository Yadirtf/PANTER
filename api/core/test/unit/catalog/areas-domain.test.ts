// HU-308: dominio del catálogo (lectura del GeoJSON, polígonos, cursor) y caché del isolate.
import { AreaImportBodySchema, type AreaImportBody } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  invalidGeometryReason,
  parseAreaImport,
} from '../../../src/modules/catalog/domain/geojson-import';
import {
  AREA_MAX_VERTICES,
  areaPolygonIssues,
  openRing,
} from '../../../src/modules/catalog/domain/geometry';
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
} from '../../../src/modules/catalog/domain/history-cursor';
import {
  CatalogCache,
  createCachedAreaReader,
} from '../../../src/modules/catalog/infrastructure/memory-catalog-cache';

const square = [
  [-76.63, 1.026],
  [-76.625, 1.026],
  [-76.625, 1.03],
  [-76.63, 1.03],
  [-76.63, 1.026],
];

const feature = (
  properties: unknown,
  geometry: unknown = { type: 'Polygon', coordinates: [square] },
) => ({
  type: 'Feature',
  properties,
  geometry,
});

const body = (features: unknown[], extra: Partial<AreaImportBody> = {}): AreaImportBody =>
  AreaImportBodySchema.parse({ geojson: { type: 'FeatureCollection', features }, ...extra });

const reasons = (b: AreaImportBody) =>
  parseAreaImport(b).errors.map((e) => [e.index, e.name, e.reason]);

describe('parseAreaImport', () => {
  it('Polygon y MultiPolygon de una parte; nombre en name/nombre sin distinguir mayúsculas', () => {
    const parsed = parseAreaImport(
      body([
        feature({ name: 'El Recreo' }),
        feature({ NOMBRE: 'San José' }, { type: 'MultiPolygon', coordinates: [[square]] }),
        feature({ Nombre: 12 }),
      ]),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.candidates.map((c) => [c.index, c.name, c.nameSearch, c.kind])).toEqual([
      [0, 'El Recreo', 'el recreo', 'BARRIO'],
      [1, 'San José', 'san jose', 'BARRIO'],
      [2, '12', '12', 'BARRIO'],
    ]);
    // El anillo se devuelve abierto, en { lat, lng }.
    expect(parsed.candidates[0]!.polygon).toEqual([
      [
        { lat: 1.026, lng: -76.63 },
        { lat: 1.026, lng: -76.625 },
        { lat: 1.03, lng: -76.625 },
        { lat: 1.03, lng: -76.63 },
      ],
    ]);
  });

  it('nameProperty y kindProperty (sin tildes ni mayúsculas); sin tipo → defaultKind', () => {
    const parsed = parseAreaImport(
      body(
        [
          feature({ NOM_BARRIO: 'Alto Guineo', CLASE: 'VEREDA' }),
          feature({ NOM_BARRIO: 'Centro', CLASE: 'Barrio' }),
          feature({ NOM_BARRIO: 'Sin tipo', CLASE: '  ' }),
        ],
        { nameProperty: 'nom_barrio', kindProperty: 'clase', defaultKind: 'VEREDA' },
      ),
    );
    expect(parsed.candidates.map((c) => [c.name, c.kind])).toEqual([
      ['Alto Guineo', 'VEREDA'],
      ['Centro', 'BARRIO'],
      ['Sin tipo', 'VEREDA'],
    ]);
  });

  it('errores por índice, en español', () => {
    const outside = [
      [-74.1, 4.6],
      [-74.0, 4.6],
      [-74.0, 4.7],
      [-74.1, 4.6],
    ];
    expect(
      reasons(
        body(
          [
            'texto',
            { type: 'Point' },
            feature({ nombre: 'Sin geometría' }, null),
            feature({ nombre: 'Punto' }, { type: 'Point', coordinates: [-76.6, 1.0] }),
            feature({ nombre: 'Rara' }, { type: 5 }),
            feature(
              { nombre: 'Dos partes' },
              { type: 'MultiPolygon', coordinates: [[square], [square]] },
            ),
            feature({ nombre: 'Vacío' }, { type: 'MultiPolygon', coordinates: [] }),
            feature({ nombre: 'Sin anillos' }, { type: 'Polygon', coordinates: [] }),
            feature({ nombre: 'Anillo malo' }, { type: 'Polygon', coordinates: ['x'] }),
            feature({ nombre: 'Punto malo' }, { type: 'Polygon', coordinates: [[[1]]] }),
            feature(
              { nombre: 'Magna Sirgas' },
              {
                type: 'Polygon',
                coordinates: [
                  [
                    [4700000, 2000000],
                    [1, 1],
                    [2, 2],
                  ],
                ],
              },
            ),
            feature({ nombre: 'Bogotá' }, { type: 'Polygon', coordinates: [outside] }),
            feature(null),
            feature({ nombre: 'X' }),
            feature({ nombre: '¿?' }),
            feature({ nombre: 'Tipo raro', tipo: 'ciudad' }),
            feature({ nombre: 'el recreo' }),
            feature({ nombre: 'El Recreo' }),
          ],
          { kindProperty: 'tipo' },
        ),
      ),
    ).toEqual([
      [0, null, 'No es una Feature de GeoJSON.'],
      [1, null, 'No es una Feature de GeoJSON.'],
      [2, 'Sin geometría', 'La feature no tiene geometría.'],
      [3, 'Punto', 'La geometría debe ser un polígono (Polygon) y es Point.'],
      [4, 'Rara', 'La geometría debe ser un polígono (Polygon) y es desconocida.'],
      [
        5,
        'Dos partes',
        'La geometría tiene 2 partes (MultiPolygon). Deja una sola parte o sepárala en barrios distintos.',
      ],
      [6, 'Vacío', 'El polígono no tiene coordenadas.'],
      [7, 'Sin anillos', 'El polígono no tiene coordenadas.'],
      [8, 'Anillo malo', 'Un borde del polígono está mal formado.'],
      [9, 'Punto malo', 'Hay una coordenada mal formada: cada punto debe ser [longitud, latitud].'],
      [
        10,
        'Magna Sirgas',
        'Hay una coordenada fuera de rango. Revisa que el archivo esté en WGS 84 (EPSG:4326) y en el orden [longitud, latitud].',
      ],
      [
        11,
        'Bogotá',
        'El polígono debe quedar dentro del área de servicio (Villagarzón, Mocoa y el corredor a Puerto Asís).',
      ],
      [12, null, 'No tiene nombre: agrega la propiedad "name" o "nombre", o indica cuál usar.'],
      [13, 'X', 'El nombre debe tener entre 2 y 80 caracteres.'],
      [14, '¿?', 'El nombre debe tener letras o números.'],
      [15, 'Tipo raro', 'El tipo «ciudad» (propiedad "tipo") no es válido: usa BARRIO o VEREDA.'],
      [17, 'El Recreo', 'Barrio repetido en el archivo: ya aparece en la feature 16.'],
    ]);
    expect(reasons(body([feature({ name: 'Otro' })], { nameProperty: 'NOMBRE_OFICIAL' }))).toEqual([
      [0, null, 'No tiene nombre en la propiedad "NOMBRE_OFICIAL".'],
    ]);
  });

  it('errores inesperados no se ocultan como errores de la feature', () => {
    const features = [feature({ name: 'Ok' })];
    Object.defineProperty(features[0], 'geometry', {
      get() {
        throw new TypeError('bug');
      },
    });
    expect(() =>
      parseAreaImport({
        geojson: { type: 'FeatureCollection', features },
        defaultKind: 'BARRIO',
        dryRun: true,
      }),
    ).toThrow(TypeError);
  });

  it('motivo de PostGIS en español', () => {
    expect(invalidGeometryReason('Self-intersection[-76.615 1.015]')).toContain(
      'Self-intersection[-76.615 1.015]',
    );
    expect(invalidGeometryReason(null)).toContain('geometría inválida');
  });
});

describe('areaPolygonIssues', () => {
  const ring = [
    { lat: 1.026, lng: -76.63 },
    { lat: 1.026, lng: -76.625 },
    { lat: 1.03, lng: -76.625 },
  ];

  it('válido dentro del área de servicio', () => {
    expect(areaPolygonIssues([ring])).toEqual([]);
  });

  it('vacío, anillo de menos de 3 puntos distintos, fuera del área o demasiados vértices', () => {
    expect(areaPolygonIssues([])).toMatchObject([{ code: 'empty_polygon' }]);
    expect(areaPolygonIssues([[ring[0]!, ring[1]!, ring[0]!]])).toMatchObject([
      { path: 'polygon.0', code: 'ring_too_small' },
    ]);
    expect(areaPolygonIssues([ring, [{ lat: 2, lng: -76.6 }, ...ring]])).toMatchObject([
      { path: 'polygon.1.0', code: 'outside_service_area' },
    ]);
    const many = Array.from({ length: AREA_MAX_VERTICES + 1 }, (_, i) => ({
      lat: 1.02 + Math.sin(i) / 1000,
      lng: -76.62 + Math.cos(i) / 1000,
    }));
    expect(areaPolygonIssues([many])).toMatchObject([{ code: 'too_many_vertices' }]);
  });

  it('openRing quita el vértice de cierre', () => {
    expect(openRing([...ring, ring[0]!])).toEqual(ring);
    expect(openRing(ring)).toEqual(ring);
    expect(openRing([])).toEqual([]);
  });
});

describe('cursor del historial', () => {
  it('ida y vuelta; alterado → null', () => {
    const cursor = { changedAt: '2026-11-20T15:00:00.123456Z', id: crypto.randomUUID() };
    expect(decodeHistoryCursor(encodeHistoryCursor(cursor))).toEqual(cursor);
    expect(decodeHistoryCursor('basura')).toBeNull();
    expect(decodeHistoryCursor(btoa('{"t":1,"i":"x"}'))).toBeNull();
    expect(decodeHistoryCursor(btoa('{"t":"ayer","i":"x"}'))).toBeNull();
  });
});

describe('CatalogCache', () => {
  it('60 s por clave; invalidar la vacía; una lectura de antes de editar no se guarda', async () => {
    const cache = new CatalogCache(60_000, 2);
    let n = 0;
    const load = async () => ++n;
    expect(await cache.get('a', 0, load)).toBe(1);
    expect(await cache.get('a', 59_999, load)).toBe(1);
    expect(await cache.get('a', 60_000, load)).toBe(2);
    await cache.get('b', 0, load);
    await cache.get('c', 0, load);
    expect(cache.size).toBe(2); // la más vieja salió

    let release: () => void = () => {};
    const slow = cache.get(
      'd',
      0,
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(99);
        }),
    );
    cache.invalidate();
    release();
    expect(await slow).toBe(99);
    expect(cache.size).toBe(0);
    // Los errores no se guardan.
    await expect(cache.get('e', 0, () => Promise.reject(new Error('Neon')))).rejects.toThrow();
    expect(cache.size).toBe(0);
  });

  it('lector de barrios en caché: lista, detalle y locate redondeado a 1 m', async () => {
    let reads = 0;
    const reader = createCachedAreaReader({
      areas: {
        list: async () => (reads++, []),
        get: async () => (reads++, null),
        getMany: async () => (reads++, []),
        locate: async () => (reads++, null),
      },
      cache: new CatalogCache(),
      now: () => 0,
    });
    await reader.list({ includeInactive: false });
    await reader.list({ includeInactive: false });
    await reader.list({ includeInactive: true, kind: 'VEREDA', search: 'guineo' });
    await reader.get('x');
    await reader.get('x');
    await reader.getMany(['b', 'a']);
    await reader.getMany(['a', 'b']);
    await reader.locate({ lat: 1.029501, lng: -76.616502 });
    await reader.locate({ lat: 1.029499, lng: -76.616498 });
    await reader.locate({ lat: -0.000001, lng: 0 });
    expect(reads).toBe(6);
  });
});
