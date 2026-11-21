import { KEY_PLACES, PLACES_LAYER, PLACES_SOURCE } from '@panter/map-style';
import { describe, expect, it } from 'vitest';
import {
  AIRPORT_PLACE,
  HOSPITAL,
  PARK_PLACE,
  POZO_AZUL,
} from '@/features/catalog/server/catalog-test-data';
import { panterStyle } from './basemap';
import {
  catalogPlacesFeatureCollection,
  PLACE_BADGE_LAYER,
  PLACE_CATEGORY_COLOR,
  PLACE_UNVERIFIED_LAYER,
  placeIcon,
} from './catalog-places';

const urls = {
  tilesUrl: 'https://api.panter.test/tiles/panter-20261101.pmtiles',
  glyphsUrl: 'https://api.panter.test/tiles/fonts/{fontstack}/{range}.pbf',
  spriteUrl: 'https://api.panter.test/tiles/sprites/v4',
};

describe('estilo de la web sin los lugares fijos de map-style', () => {
  it('la fuente panter-places empieza vacía (la llena GET /places)', () => {
    for (const theme of ['light', 'dark'] as const) {
      const style = panterStyle(urls, theme);
      const source = style.sources[PLACES_SOURCE] as { type: string; data: unknown };
      expect(source.type).toBe('geojson');
      expect(source.data).toEqual({ type: 'FeatureCollection', features: [] });
      const json = JSON.stringify(style);
      for (const fixed of KEY_PLACES) expect(json).not.toContain(fixed.name);
    }
  });

  it('agrega el anillo de "sin verificar" y la insignia de color debajo de los íconos', () => {
    const ids = panterStyle(urls, 'light').layers.map((l) => l.id);
    const places = ids.indexOf(PLACES_LAYER);
    expect(ids.indexOf(PLACE_UNVERIFIED_LAYER)).toBe(places - 2);
    expect(ids.indexOf(PLACE_BADGE_LAYER)).toBe(places - 1);
    expect(places).toBe(ids.length - 1);
  });
});

describe('lugares del catálogo como GeoJSON', () => {
  it('íconos de map-style: por slug para los puntos clave y por categoría para los demás', () => {
    expect(placeIcon(POZO_AZUL)).toBe('place-pool');
    expect(placeIcon(AIRPORT_PLACE)).toBe('place-airport');
    expect(placeIcon({ slug: 'mirador-nuevo', category: 'TOURISM' })).toBe('place-nature');
    expect(placeIcon(HOSPITAL)).toBeNull();
  });

  it('propiedades para el estilo: ícono o insignia, sin verificar y activo', () => {
    const fc = catalogPlacesFeatureCollection([AIRPORT_PLACE, PARK_PLACE, HOSPITAL]);
    expect(fc.features.map((f) => f.properties)).toEqual([
      expect.objectContaining({ icon: 'place-airport', hasIcon: true, approximate: false }),
      expect.objectContaining({ icon: 'place-park', hasIcon: true, approximate: true }),
      {
        id: HOSPITAL.id,
        name: 'Hospital local',
        icon: '',
        hasIcon: false,
        approximate: false,
        active: false,
        color: PLACE_CATEGORY_COLOR.HEALTH,
      },
    ]);
    expect(fc.features[0]!.geometry.coordinates).toEqual([-76.6053, 0.9789]);
  });
});
