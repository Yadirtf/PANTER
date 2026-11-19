import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION,
  BASEMAP_SOURCE,
  basemapUrls,
  buildStyle,
  LABEL_SCALE,
  parseBasemapManifest,
  PLACES_LAYER,
  PLACES_SOURCE,
  scaleTextSize,
  SERVICE_AREA_BOUNDS,
} from './style';
import { FONTS, PALETTES, type MapTheme } from './palette';
import { KEY_PLACES } from './places';
import { MAP_ICONS } from './icons';

const API = 'https://panter-api-staging.panter.workers.dev';
const urls = basemapUrls(`${API}/`, { file: 'panter-20261117.pmtiles' });

describe.each<MapTheme>(['light', 'dark'])('buildStyle(%s)', (theme) => {
  const style = buildStyle({ ...urls, theme });

  it('es un estilo MapLibre válido según @maplibre/maplibre-gl-style-spec', () => {
    expect(validateStyleMin(style)).toEqual([]);
  });

  it('usa el mapa base, glifos y sprites servidos por panter-api', () => {
    expect(style.sources[BASEMAP_SOURCE]).toMatchObject({
      type: 'vector',
      url: `pmtiles://${API}/tiles/panter-20261117.pmtiles`,
      attribution: ATTRIBUTION,
    });
    expect(style.glyphs).toBe(`${API}/tiles/fonts/{fontstack}/{range}.pbf`);
    expect(style.sprite).toBe(`${API}/tiles/sprites/v4/${theme}`);
  });

  it('solo pide las fuentes que se suben a R2', () => {
    const fonts = new Set<string>();
    const collect = (value: unknown): void => {
      if (typeof value === 'string' && value.startsWith('Noto Sans')) fonts.add(value);
      else if (Array.isArray(value)) value.forEach(collect);
    };
    for (const layer of style.layers) {
      if (layer.type === 'symbol') collect(layer.layout?.['text-font']);
    }
    expect([...fonts].sort()).toEqual(Object.values(FONTS).sort());
  });

  it('etiquetas en español (name:es con respaldo a name)', () => {
    expect(JSON.stringify(style.layers)).toContain('name:es');
  });

  it('aplica la paleta PANTER (selva, agua y troncales)', () => {
    const p = PALETTES[theme];
    const paint = (id: string) =>
      (style.layers.find((l) => l.id === id) as { paint?: Record<string, unknown> }).paint;
    expect(style.layers.find((l) => l.id === 'background')).toMatchObject({
      paint: { 'background-color': p.background },
    });
    expect(paint('water')?.['fill-color']).toBe(p.water);
    expect(JSON.stringify(style.layers)).toContain(p.highway);
    expect(JSON.stringify(style.layers)).toContain(p.jungleDeep);
  });

  it('los puntos clave van encima, siempre visibles y con su ícono', () => {
    const last = style.layers.at(-1)!;
    expect(last.id).toBe(PLACES_LAYER);
    expect(last).toMatchObject({
      type: 'symbol',
      source: PLACES_SOURCE,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-optional': true,
      },
    });
    const source = style.sources[PLACES_SOURCE] as {
      data: { features: { properties: { icon: string; name: string } }[] };
    };
    expect(source.data.features.map((f) => f.properties.name)).toEqual(
      KEY_PLACES.map((p) => p.name),
    );
    for (const feature of source.data.features) {
      expect(MAP_ICONS).toHaveProperty(feature.properties.icon);
    }
  });

  it('se centra en Villagarzón', () => {
    expect(style.center).toEqual([-76.6165, 1.0295]);
    expect(style.metadata).toEqual({ 'panter:theme': theme });
  });
});

describe('buildStyle: entradas', () => {
  it('respeta una URL que ya trae pmtiles:// (archivo descargado en el teléfono)', () => {
    const style = buildStyle({
      ...urls,
      tilesUrl: 'pmtiles://file:///data/panter-20261117.pmtiles',
      theme: 'light',
    });
    expect(style.sources[BASEMAP_SOURCE]).toMatchObject({
      url: 'pmtiles://file:///data/panter-20261117.pmtiles',
    });
  });

  it('rechaza una plantilla de glifos sin {fontstack} o {range}', () => {
    expect(() => buildStyle({ ...urls, glyphsUrl: `${API}/tiles/fonts`, theme: 'dark' })).toThrow(
      /fontstack/,
    );
  });

  it('el tema claro y el oscuro difieren en colores', () => {
    expect(JSON.stringify(buildStyle({ ...urls, theme: 'light' }).layers)).not.toEqual(
      JSON.stringify(buildStyle({ ...urls, theme: 'dark' }).layers),
    );
  });

  it('expone la caja de servicio para maxBounds', () => {
    expect(SERVICE_AREA_BOUNDS).toEqual([
      [-77.05, 0.4],
      [-76.3, 1.3],
    ]);
  });
});

describe('scaleTextSize', () => {
  it('escala números y las salidas de interpolate, step, case y match', () => {
    expect(scaleTextSize(12, LABEL_SCALE)).toBe(15);
    expect(scaleTextSize(['interpolate', ['linear'], ['zoom'], 3, 10, 10, 12], 1.5)).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      3,
      15,
      10,
      18,
    ]);
    expect(scaleTextSize(['step', ['zoom'], 10, 12, 14], 2)).toEqual([
      'step',
      ['zoom'],
      20,
      12,
      28,
    ]);
    expect(scaleTextSize(['case', ['has', 'x'], 10, 8], 2)).toEqual(['case', ['has', 'x'], 20, 16]);
    expect(scaleTextSize(['match', ['get', 'k'], 'a', 10, 8], 2)).toEqual([
      'match',
      ['get', 'k'],
      'a',
      20,
      16,
    ]);
    expect(scaleTextSize(['get', 'size'], 2)).toEqual(['get', 'size']);
    expect(scaleTextSize('x', 2)).toBe('x');
  });
});

describe('parseBasemapManifest', () => {
  const manifest = {
    file: 'panter-20261117.pmtiles',
    build: '20261117',
    bounds: [-77.05, 0.4, -76.3, 1.3],
    maxzoom: 15,
    size: 12345,
    sha256: 'abc',
    generatedAt: '2026-11-17T10:00:00Z',
    pmtilesVersion: '1.31.2',
    assetsCommit: '028c18f',
  };

  it('acepta el manifiesto que genera scripts/generar_mapa.sh', () => {
    expect(parseBasemapManifest(manifest)).toEqual(manifest);
  });

  it('rechaza nombres o campos inválidos', () => {
    expect(() => parseBasemapManifest(null)).toThrow(/basemap.json/);
    expect(() => parseBasemapManifest({ ...manifest, file: '../x.pmtiles' })).toThrow();
    expect(() => parseBasemapManifest({ ...manifest, bounds: [1, 2] })).toThrow();
  });
});
