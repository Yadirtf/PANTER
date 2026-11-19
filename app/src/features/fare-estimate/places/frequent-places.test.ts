import { isInServiceArea } from '@panter/contracts';
import { KEY_PLACES } from '@panter/map-style';
import { describe, expect, it } from 'vitest';
import { FREQUENT_PLACES, normalizeSearch, searchPlaces } from './frequent-places';

describe('lugares frecuentes', () => {
  it('incluye los puntos clave del mapa y los centros de Mocoa y Puerto Asís', () => {
    const ids = FREQUENT_PLACES.map((p) => p.id);
    for (const place of KEY_PLACES) expect(ids).toContain(place.id);
    expect(ids).toContain('centro-mocoa');
    expect(ids).toContain('centro-puerto-asis');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('todos están dentro del área de servicio', () => {
    for (const place of FREQUENT_PLACES) expect(isInServiceArea(place.position)).toBe(true);
  });

  it('marca como aproximadas las coordenadas sin verificar', () => {
    const byId = Object.fromEntries(FREQUENT_PLACES.map((p) => [p.id, p]));
    expect(byId['aeropuerto-cananguchal']?.approximate).toBe(false);
    expect(byId['pozo-azul']?.approximate).toBe(true);
  });
});

describe('searchPlaces', () => {
  it('sin texto devuelve toda la lista', () => {
    expect(searchPlaces('')).toHaveLength(FREQUENT_PLACES.length);
    expect(searchPlaces('   ')).toHaveLength(FREQUENT_PLACES.length);
  });

  it('ignora tildes y mayúsculas', () => {
    expect(normalizeSearch('  Río  GUINEO ')).toBe('rio guineo');
    expect(searchPlaces('rio').map((p) => p.id)).toContain('rio-guineo');
    expect(searchPlaces('PUERTO ASÍS').map((p) => p.id)).toEqual(['centro-puerto-asis']);
  });

  it('busca por palabras clave (aeropuerto, VGZ) y por varias palabras', () => {
    expect(searchPlaces('vgz').map((p) => p.id)).toEqual(['aeropuerto-cananguchal']);
    expect(searchPlaces('aeropuerto')[0]?.id).toBe('aeropuerto-cananguchal');
    expect(searchPlaces('cascadas vica').map((p) => p.id)).toEqual(['cascadas-de-vica']);
  });

  it('prioriza los que empiezan por la búsqueda', () => {
    expect(
      searchPlaces('centro')
        .map((p) => p.id)
        .slice(0, 2),
    ).toEqual(['centro-mocoa', 'centro-puerto-asis']);
  });

  it('sin coincidencias devuelve una lista vacía', () => {
    expect(searchPlaces('bogotá')).toEqual([]);
  });
});
