import { AreaCreateBodySchema, AreaUpdateBodySchema, PLACES } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  ALL_AREAS,
  ALTO_SINAI,
  CENTRO,
  SAN_JOSE,
  square,
  summary,
  VIEJO,
} from '@/features/catalog/server/catalog-test-data';
import { insertMidpoint, moveVertex, toEditable } from '@/features/geo-editor/lib/polygon-edit';
import {
  AREA_FIELD_ERROR,
  AREA_KIND_COLOR,
  areaChanges,
  areaCreateBody,
  areaShape,
  areaUpdateBody,
  DEFAULT_DRAWN_SOURCE,
  emptyAreaForm,
  filterAreas,
  formToAreaFields,
  overlapWarnings,
  pointTestMessage,
  testPoint,
} from './areas';

const summaries = ALL_AREAS.map(summary);

describe('lista de barrios y veredas', () => {
  it('busca sin tildes ni mayúsculas (searchKey de contracts)', () => {
    expect(filterAreas(summaries, { q: 'san jose', kind: '' }).map((a) => a.name)).toEqual([
      'San José',
    ]);
    expect(filterAreas(summaries, { q: 'SINAÍ', kind: '' }).map((a) => a.name)).toEqual([
      'Alto Sinaí',
    ]);
    // Varias palabras en cualquier orden.
    expect(filterAreas(summaries, { q: 'viejo centro', kind: '' }).map((a) => a.name)).toEqual([
      'Centro viejo',
    ]);
  });

  it('filtra por tipo y pone los activos primero, en orden alfabético', () => {
    expect(filterAreas(summaries, { q: '', kind: 'VEREDA' }).map((a) => a.name)).toEqual([
      'Alto Sinaí',
    ]);
    expect(filterAreas(summaries, { q: '', kind: 'BARRIO' }).map((a) => a.name)).toEqual([
      'Centro',
      'San José',
      'Centro viejo',
    ]);
  });

  it('cada tipo con su color en el mapa', () => {
    expect(areaShape(CENTRO).color).toBe(AREA_KIND_COLOR.BARRIO);
    expect(areaShape(ALTO_SINAI).color).toBe(AREA_KIND_COLOR.VEREDA);
    expect(AREA_KIND_COLOR.BARRIO).not.toBe(AREA_KIND_COLOR.VEREDA);
  });
});

describe('formulario y cuerpos de la API', () => {
  it('valida nombre, tipo y fuente con el esquema de contracts', () => {
    expect(formToAreaFields({ name: ' X ', kind: 'BARRIO', source: '' })).toEqual({
      ok: false,
      errors: { name: AREA_FIELD_ERROR.name },
    });
    expect(formToAreaFields({ name: 'Centro', kind: 'BARRIO', source: 'x'.repeat(201) })).toEqual({
      ok: false,
      errors: { source: AREA_FIELD_ERROR.source },
    });
    expect(formToAreaFields({ name: '  La Libertad ', kind: 'BARRIO', source: '  ' })).toEqual({
      ok: true,
      body: { name: 'La Libertad', kind: 'BARRIO', source: null },
    });
    expect(emptyAreaForm().source).toBe(DEFAULT_DRAWN_SOURCE);
  });

  it('crear: los campos y el polígono dibujado, cerrado', () => {
    const rings = toEditable(CENTRO.polygon);
    const body = areaCreateBody({ name: 'Centro', kind: 'BARRIO', source: null }, rings);
    expect(body).toEqual({ name: 'Centro', kind: 'BARRIO', source: null, polygon: CENTRO.polygon });
    expect(AreaCreateBodySchema.safeParse(body).success).toBe(true);
  });

  it('editar: solo lo que cambió; sin tocar el mapa no se envía el polígono', () => {
    const same = { name: CENTRO.name, kind: CENTRO.kind, source: CENTRO.source };
    expect(areaUpdateBody(CENTRO, same, toEditable(CENTRO.polygon))).toEqual({});
    expect(areaUpdateBody(CENTRO, { ...same, name: 'Centro histórico' }, null)).toEqual({
      name: 'Centro histórico',
    });
    const edited = insertMidpoint(toEditable(CENTRO.polygon), 0, 1).rings;
    const body = areaUpdateBody(CENTRO, { ...same, source: null }, edited);
    expect(body).toEqual({ source: null, polygon: expect.any(Array) });
    expect(body.polygon![0]).toHaveLength(6);
    expect(AreaUpdateBodySchema.safeParse(body).success).toBe(true);
  });

  it('confirmación con diff legible (también para crear)', () => {
    const edited = moveVertex(
      toEditable(CENTRO.polygon),
      { ring: 0, vertex: 1 },
      {
        lat: 1.025,
        lng: -76.612,
      },
    );
    const body = areaUpdateBody(
      CENTRO,
      { name: 'Centro histórico', kind: 'VEREDA', source: CENTRO.source },
      edited,
    );
    expect(areaChanges(CENTRO, body)).toEqual([
      { field: 'name', label: 'Nombre', before: 'Centro', after: 'Centro histórico' },
      { field: 'kind', label: 'Tipo', before: 'Barrio', after: 'Vereda' },
      {
        field: 'polygon',
        label: 'Polígono',
        before: '4 vértices',
        after: '4 vértices (1 vértice movido)',
      },
    ]);
    const created = areaChanges(
      null,
      areaCreateBody({ name: 'La Paz', kind: 'BARRIO', source: null }, edited),
    );
    expect(created).toEqual([
      { field: 'name', label: 'Nombre', before: '—', after: 'La Paz' },
      { field: 'kind', label: 'Tipo', before: '—', after: 'Barrio' },
      { field: 'active', label: 'Activo', before: '—', after: 'Sí' },
      { field: 'polygon', label: 'Polígono', before: '—', after: '4 vértices' },
    ]);
  });
});

describe('solapamiento como advertencia', () => {
  it('avisa con los barrios activos que se solapan, sin contarse a sí mismo', () => {
    const drawn = [square(-76.615, 1.027, -76.61, 1.032)];
    expect(overlapWarnings(drawn, ALL_AREAS, null)).toEqual([
      'Se solapa con Barrio Centro. Puedes guardarlo igual, pero revisa los límites.',
      'Se solapa con Barrio San José. Puedes guardarlo igual, pero revisa los límites.',
    ]);
    // El Centro editado no se compara consigo mismo; el "Centro viejo" está desactivado.
    expect(overlapWarnings(CENTRO.polygon, ALL_AREAS, CENTRO.id)).toEqual([]);
  });
});

describe('Probar un punto', () => {
  it('el Parque principal está en el Centro; el desactivado se menciona aparte', () => {
    const result = testPoint(PLACES.VILLAGARZON_CENTER, ALL_AREAS);
    expect(result.active.map((a) => a.id)).toEqual([CENTRO.id]);
    expect(result.inactive.map((a) => a.id)).toEqual([VIEJO.id]);
    expect(pointTestMessage(result)).toBe('Este punto está en Barrio Centro.');
  });

  it('punto sin barrio, fuera del área de servicio y en un solapamiento', () => {
    expect(pointTestMessage(testPoint({ lat: 1.1, lng: -76.7 }, ALL_AREAS))).toBe(
      'Ningún barrio o vereda cubre este punto.',
    );
    expect(pointTestMessage(testPoint({ lat: 2, lng: -76.6 }, ALL_AREAS))).toBe(
      'Este punto está fuera del área de servicio de PANTER.',
    );
    const overlap = [CENTRO, { ...SAN_JOSE, polygon: [square(-76.618, 1.026, -76.606, 1.033)] }];
    expect(pointTestMessage(testPoint({ lat: 1.03, lng: -76.616 }, overlap))).toBe(
      'Este punto está en Barrio Centro. También lo cubre Barrio San José: revisa el solapamiento.',
    );
    expect(pointTestMessage(testPoint({ lat: 1.0295, lng: -76.6165 }, [VIEJO]))).toBe(
      'Ningún barrio o vereda activo cubre este punto (solo Barrio Centro viejo, desactivado).',
    );
  });
});
