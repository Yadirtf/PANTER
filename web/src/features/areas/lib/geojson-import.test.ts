import {
  AREA_IMPORT_MAX_FEATURES,
  AreaImportBodySchema,
  type AreaImportResult,
} from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { CENTRO } from '@/features/catalog/server/catalog-test-data';
import { AREA_KIND_COLOR } from './areas';
import {
  AREA_IMPORT_MAX_BYTES,
  defaultImportSource,
  importBody,
  parseImportFile,
  previewShapes,
  previewSummary,
} from './geojson-import';

const ring = [
  [-76.62, 1.026],
  [-76.613, 1.026],
  [-76.613, 1.033],
  [-76.62, 1.033],
  [-76.62, 1.026],
];

const feature = (properties: Record<string, unknown>) => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Polygon', coordinates: [ring] },
});

const collection = (features: unknown[]) => JSON.stringify({ type: 'FeatureCollection', features });

const parse = (text: string) => parseImportFile(text, new TextEncoder().encode(text).length);

describe('leer el archivo GeoJSON en el navegador', () => {
  it('FeatureCollection válida: cuenta las features y sugiere nombre y tipo', () => {
    const result = parse(
      collection([
        feature({ NOMBRE: 'Centro', Tipo: 'Barrio', area_m2: 120000 }),
        feature({ NOMBRE: 'Alto Sinaí', Tipo: 'Vereda', codigo: 'V-12' }),
      ]),
    );
    expect(result).toMatchObject({
      ok: true,
      featureCount: 2,
      // Solo propiedades de texto (area_m2 es un número).
      propertyKeys: ['NOMBRE', 'Tipo', 'codigo'],
      suggestedNameProperty: 'NOMBRE',
      suggestedKindProperty: 'Tipo',
    });
  });

  it('sin propiedades conocidas no sugiere nada', () => {
    expect(parse(collection([feature({ barrio_x: 'Centro' })]))).toMatchObject({
      ok: true,
      suggestedNameProperty: null,
      suggestedKindProperty: null,
    });
  });

  it('rechaza lo que no es JSON, lo que no es FeatureCollection y la colección vacía', () => {
    expect(parse('{ esto no es json')).toEqual({
      ok: false,
      message: 'El archivo no es un GeoJSON válido: no se pudo leer como JSON.',
    });
    expect(parse('[1, 2]')).toEqual({ ok: false, message: 'El archivo no es un GeoJSON válido.' });
    expect(parse(JSON.stringify(feature({ name: 'Centro' })))).toEqual({
      ok: false,
      message:
        'El archivo tiene un solo polígono: se espera una FeatureCollection (una colección de polígonos con su nombre).',
    });
    expect(parse(JSON.stringify({ type: 'GeometryCollection', geometries: [] }))).toEqual({
      ok: false,
      message: 'Se espera un GeoJSON de tipo FeatureCollection.',
    });
    expect(parse(collection([]))).toEqual({
      ok: false,
      message: 'La FeatureCollection no tiene polígonos.',
    });
  });

  it(`máximo ${AREA_IMPORT_MAX_FEATURES} features por importación`, () => {
    const many = Array.from({ length: AREA_IMPORT_MAX_FEATURES + 1 }, (_, i) =>
      feature({ name: `Vereda ${i}` }),
    );
    expect(parse(collection(many))).toEqual({
      ok: false,
      message: `El archivo tiene ${AREA_IMPORT_MAX_FEATURES + 1} polígonos; el máximo por importación es ${AREA_IMPORT_MAX_FEATURES}. Divídelo en varios archivos.`,
    });
    expect(parse(collection(many.slice(1))).ok).toBe(true);
  });

  it('tamaño razonable: un archivo de más de 5 MB se rechaza sin leerlo', () => {
    expect(parseImportFile('', AREA_IMPORT_MAX_BYTES + 1)).toEqual({
      ok: false,
      message:
        'El archivo pesa 5,0 MB; el máximo es 5,0 MB. Simplifica los polígonos o divide el archivo.',
    });
  });
});

describe('cuerpo de POST /admin/areas/import', () => {
  const parsed = parse(collection([feature({ nombre: 'Centro' })]));
  if (!parsed.ok) throw new Error(parsed.message);

  it('vista previa (dryRun) con la propiedad del nombre y el tipo por defecto', () => {
    const body = importBody(
      parsed.geojson,
      { nameProperty: 'nombre', kindProperty: '', defaultKind: 'VEREDA', source: '  ' },
      true,
    );
    expect(body).toEqual({
      geojson: parsed.geojson,
      nameProperty: 'nombre',
      defaultKind: 'VEREDA',
      dryRun: true,
    });
    expect(AreaImportBodySchema.safeParse(body).success).toBe(true);
  });

  it('confirmar: el mismo cuerpo con dryRun false, la propiedad del tipo y la fuente', () => {
    const body = importBody(
      parsed.geojson,
      {
        nameProperty: 'nombre',
        kindProperty: 'tipo',
        defaultKind: 'BARRIO',
        source: defaultImportSource('barrios-pot-2024.geojson'),
      },
      false,
    );
    expect(body).toMatchObject({
      kindProperty: 'tipo',
      source: 'Importado de barrios-pot-2024.geojson',
      dryRun: false,
    });
  });
});

describe('vista previa', () => {
  const result: AreaImportResult = {
    dryRun: true,
    valid: [
      { index: 0, name: 'Centro', kind: 'BARRIO', polygon: CENTRO.polygon, replacesExisting: true },
      {
        index: 2,
        name: 'Alto Sinaí',
        kind: 'VEREDA',
        polygon: CENTRO.polygon,
        replacesExisting: false,
      },
    ],
    errors: [{ index: 1, name: 'Mohano', reason: 'El polígono se cruza consigo mismo' }],
    saved: 0,
  };

  it('los válidos en el mapa, con color por tipo y los reemplazos marcados', () => {
    expect(previewShapes(result)).toEqual([
      expect.objectContaining({
        id: 'importar-0',
        name: 'Centro (reemplaza)',
        color: AREA_KIND_COLOR.BARRIO,
      }),
      expect.objectContaining({
        id: 'importar-2',
        name: 'Alto Sinaí',
        color: AREA_KIND_COLOR.VEREDA,
      }),
    ]);
  });

  it('resumen en español', () => {
    expect(previewSummary(result)).toBe(
      '2 polígonos válidos (1 reemplaza a uno existente); 1 con errores, que no se importará.',
    );
    expect(previewSummary({ ...result, valid: result.valid.slice(1), errors: [] })).toBe(
      '1 polígono válido; sin errores.',
    );
  });
});
