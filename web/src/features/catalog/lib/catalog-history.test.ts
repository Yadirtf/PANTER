import { describe, expect, it } from 'vitest';
import { AREA_CHANGE, CENTRO } from '../server/catalog-test-data';
import {
  appendCatalogPage,
  catalogChangeAuthor,
  catalogDiff,
  formatCatalogValue,
  snapshotPolygon,
} from './catalog-history';

describe('historial del catálogo con diff legible', () => {
  it('nombre y polígono de una modificación', () => {
    expect(catalogDiff(AREA_CHANGE.before, AREA_CHANGE.after)).toEqual([
      { field: 'name', label: 'Nombre', before: 'Centro', after: 'Centro histórico' },
      {
        field: 'polygon',
        label: 'Polígono',
        before: '4 vértices',
        after: '5 vértices (1 vértice agregado)',
      },
    ]);
  });

  it('creación: todo aparece como nuevo, con el tipo en español; sin ids ni metadatos', () => {
    const after = {
      id: CENTRO.id,
      name: 'Centro',
      name_search: 'centro',
      kind: 'VEREDA',
      active: true,
      source: null,
      updated_at: '2026-11-16T15:30:00.000Z',
      polygon: CENTRO.polygon,
    };
    expect(catalogDiff(null, after)).toEqual([
      { field: 'name', label: 'Nombre', before: '—', after: 'Centro' },
      { field: 'kind', label: 'Tipo', before: '—', after: 'Vereda' },
      { field: 'active', label: 'Activo', before: '—', after: 'Sí' },
      { field: 'polygon', label: 'Polígono', before: '—', after: 'Polígono de 4 vértices' },
    ]);
  });

  it('desactivar', () => {
    expect(catalogDiff({ active: true }, { active: false })).toEqual([
      { field: 'active', label: 'Activo', before: 'Sí', after: 'No' },
    ]);
  });

  it('acepta el polígono como GeoJSON y no muestra cambios falsos', () => {
    const geojson = {
      type: 'Polygon',
      coordinates: CENTRO.polygon.map((ring) => ring.map((p) => [p.lng, p.lat])),
    };
    expect(snapshotPolygon(geojson)).toEqual(CENTRO.polygon);
    expect(catalogDiff({ polygon: geojson }, { polygon: CENTRO.polygon })).toEqual([]);
    expect(formatCatalogValue('polygon', 'basura')).toBe('Polígono');
  });

  it('autor y páginas sin repetir', () => {
    expect(catalogChangeAuthor({ changedBy: null })).toBe('Sistema (carga inicial)');
    const state = { items: [AREA_CHANGE], nextCursor: 'c2' };
    expect(appendCatalogPage(state, { items: [AREA_CHANGE], nextCursor: null })).toEqual({
      items: [AREA_CHANGE],
      nextCursor: null,
    });
  });
});
