import { describe, expect, it } from 'vitest';
import { matchRank, placeCategories, searchAreas, searchCatalogPlaces } from './search';
import { AREAS, PLACES_CATALOG } from './test-helpers';

const names = <T extends { name: string }>(items: T[]) => items.map((i) => i.name);

describe('searchAreas', () => {
  it('sin búsqueda: activos agrupados, primero barrios y luego veredas, en orden alfabético', () => {
    expect(searchAreas(AREAS, '')).toEqual([
      { kind: 'BARRIO', title: 'Barrios', items: [AREAS[0], AREAS[1], AREAS[2]] },
      { kind: 'VEREDA', title: 'Veredas', items: [AREAS[3], AREAS[4]] },
    ]);
  });

  it('ignora tildes y mayúsculas en la búsqueda y en el nombre', () => {
    expect(searchAreas(AREAS, 'san jose')[0]?.items.map((a) => a.name)).toEqual(['San José']);
    expect(searchAreas(AREAS, 'MANSOYÁ')[0]?.items.map((a) => a.name)).toEqual(['Bajo Mansoyá']);
    expect(searchAreas(AREAS, 'mansoya')[0]?.kind).toBe('VEREDA');
  });

  it('busca por palabras sueltas y por el tipo ("vereda guineo")', () => {
    expect(searchAreas(AREAS, 'guineo alto').flatMap((g) => names(g.items))).toEqual([
      'Alto Guineo',
    ]);
    expect(searchAreas(AREAS, 'vereda').map((g) => g.kind)).toEqual(['VEREDA']);
  });

  it('no muestra desactivados ni grupos vacíos', () => {
    expect(searchAreas(AREAS, 'cedro')).toEqual([]);
    expect(searchAreas(AREAS, 'rosa').map((g) => g.kind)).toEqual(['BARRIO']);
  });
});

describe('searchCatalogPlaces', () => {
  it('sin tildes: "rio" encuentra Río Guineo y "guzman" el hospital', () => {
    expect(names(searchCatalogPlaces(PLACES_CATALOG, 'rio'))).toEqual(['Río Guineo']);
    expect(names(searchCatalogPlaces(PLACES_CATALOG, 'GUZMAN'))).toEqual([
      'Hospital Jorge Julio Guzmán',
    ]);
  });

  it('por categoría (texto o filtro) y por barrio', () => {
    expect(names(searchCatalogPlaces(PLACES_CATALOG, 'salud'))).toEqual([
      'Hospital Jorge Julio Guzmán',
    ]);
    expect(names(searchCatalogPlaces(PLACES_CATALOG, '', 'TOURISM'))).toEqual(['Río Guineo']);
    expect(names(searchCatalogPlaces(PLACES_CATALOG, 'centro'))).toEqual(['Parque principal']);
  });

  it('primero los que empiezan por la búsqueda; sin los desactivados', () => {
    expect(names(searchCatalogPlaces(PLACES_CATALOG, 'parque'))[0]).toBe('Parque principal');
    expect(names(searchCatalogPlaces(PLACES_CATALOG, 'matadero'))).toEqual([]);
    expect(searchCatalogPlaces(PLACES_CATALOG, '')).toHaveLength(4);
  });

  it('categorías presentes en el orden del contrato', () => {
    expect(placeCategories(PLACES_CATALOG)).toEqual(['AIRPORT', 'PARK', 'TOURISM', 'HEALTH']);
  });

  it('matchRank', () => {
    expect(matchRank('', 'Lo que sea')).toBe(0);
    expect(matchRank('pozo', 'Pozo Azul')).toBe(0);
    expect(matchRank('azul', 'Pozo Azul')).toBe(1);
    expect(matchRank('verde', 'Pozo Azul')).toBeNull();
  });
});
