import { layers, namedFlavor } from '@protomaps/basemaps';
import { buildStyle, PLACES_LAYER } from '@panter/map-style';
import { describe, expect, it } from 'vitest';
import { BASEMAP_POI_LAYER, poiFromFeatures, poiName, TAPPABLE_POI_LAYERS } from './poi';

const TAP = { lat: 1.03, lng: -76.617 };

function feature(
  properties: Record<string, unknown> | null,
  coordinates: [number, number] = [-76.6162, 1.0297],
): GeoJSON.Feature {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates } };
}

describe('capas de POI que se pueden tocar', () => {
  it('existen en el estilo de @panter/map-style (claro y oscuro)', () => {
    for (const theme of ['light', 'dark'] as const) {
      const style = buildStyle({
        tilesUrl: 'https://api.test/tiles/panter-20261118.pmtiles',
        glyphsUrl: 'https://api.test/tiles/fonts/{fontstack}/{range}.pbf',
        spriteUrl: 'https://api.test/tiles/sprites/v4',
        theme,
      });
      const ids = style.layers.map((layer) => layer.id);
      for (const id of TAPPABLE_POI_LAYERS) expect(ids).toContain(id);
    }
  });

  it('"pois" es la capa de puntos de interés de @protomaps/basemaps', () => {
    const poi = layers('protomaps', namedFlavor('light'), { lang: 'es' }).find(
      (layer) => layer.id === BASEMAP_POI_LAYER,
    );
    expect(poi).toMatchObject({ type: 'symbol', 'source-layer': 'pois' });
    expect(TAPPABLE_POI_LAYERS).toEqual([PLACES_LAYER, 'pois']);
  });
});

describe('poiFromFeatures', () => {
  it('toma el primer elemento con nombre, en español si lo tiene, en su posición', () => {
    const poi = poiFromFeatures(
      [
        feature({ kind: 'bench' }),
        feature({
          name: 'Droguería La Rebaja',
          'name:es': 'Droguería La Rebaja',
          kind: 'pharmacy',
        }),
      ],
      TAP,
    );
    expect(poi).toEqual({
      name: 'Droguería La Rebaja',
      point: { lat: 1.0297, lng: -76.6162 },
      kind: 'pharmacy',
      placeSlug: null,
    });
  });

  it('nombre local si no hay name:es; ignora nombres vacíos', () => {
    expect(poiName({ name: '  Panadería El Trigal ' })).toBe('Panadería El Trigal');
    expect(poiName({ 'name:es': '', name: 'Iglesia' })).toBe('Iglesia');
    expect(poiName({ name: '   ' })).toBeNull();
    expect(poiName(null)).toBeNull();
  });

  it('puntos clave de PANTER (propiedad name, sin kind)', () => {
    const keyPlace = feature({ id: 'pozo-azul', name: 'Pozo Azul', icon: 'place-pool' });
    expect(poiFromFeatures([keyPlace], TAP)).toMatchObject({
      name: 'Pozo Azul',
      kind: null,
      placeSlug: 'pozo-azul',
    });
    // Un POI de OSM con `id` en sus propiedades no se confunde con un punto clave.
    expect(poiFromFeatures([feature({ id: 'x', name: 'Tienda' })], TAP)?.placeSlug).toBeNull();
  });

  it('sin elementos con nombre no hay POI; sin punto se usa el tocado', () => {
    expect(poiFromFeatures([], TAP)).toBeNull();
    expect(poiFromFeatures([feature({ kind: 'bench' })], TAP)).toBeNull();
    const polygon: GeoJSON.Feature = {
      type: 'Feature',
      properties: { name: 'Coliseo' },
      geometry: { type: 'Polygon', coordinates: [] },
    };
    expect(poiFromFeatures([polygon], TAP)?.point).toEqual(TAP);
  });
});
