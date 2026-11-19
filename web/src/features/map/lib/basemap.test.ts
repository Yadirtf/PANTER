import { PLACES, SERVICE_AREA } from '@panter/contracts';
import { BASEMAP_SOURCE, PLACES_LAYER } from '@panter/map-style';
import { describe, expect, it, vi } from 'vitest';
import {
  BASEMAP_ERROR_MESSAGE,
  BasemapError,
  basemapManifestUrl,
  loadBasemap,
  MAP_LOCALE_ES,
  MAP_VIEW,
  panterStyle,
} from './basemap';

const API = 'https://panter-api-staging.panter.workers.dev';

/** Manifiesto como el que publica scripts/generar_mapa.sh en staging. */
const MANIFEST = {
  file: 'panter-20261118.pmtiles',
  build: '20261118',
  bounds: [-77.05, 0.4, -76.3, 1.3],
  maxzoom: 15,
  size: 48_213_504,
  sha256: 'a'.repeat(64),
  generatedAt: '2026-11-18T10:00:00Z',
  pmtilesVersion: '1.22.3',
  assetsCommit: 'abc1234',
};

function fetchReturning(response: Response | Error) {
  return vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
}

describe('manifiesto y URLs del mapa base', () => {
  it('lee /tiles/basemap.json sin credenciales ni token y arma las URLs', async () => {
    const fetchMock = fetchReturning(Response.json(MANIFEST));
    const { manifest, urls } = await loadBasemap(`${API}/`, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API}/tiles/basemap.json`);
    expect(init?.credentials).toBe('omit');
    expect(Object.keys(init?.headers ?? {}).map((h) => h.toLowerCase())).not.toContain(
      'authorization',
    );

    expect(manifest.file).toBe('panter-20261118.pmtiles');
    expect(urls).toEqual({
      tilesUrl: `${API}/tiles/panter-20261118.pmtiles`,
      glyphsUrl: `${API}/tiles/fonts/{fontstack}/{range}.pbf`,
      spriteUrl: `${API}/tiles/sprites/v4`,
    });
  });

  it('URL del manifiesto sin barras dobles', () => {
    expect(basemapManifestUrl('http://localhost:8787///')).toBe(
      'http://localhost:8787/tiles/basemap.json',
    );
  });

  it('errores claros si la API no responde, responde mal o el manifiesto no es válido', async () => {
    const cases: [Response | Error, BasemapError['reason']][] = [
      [new TypeError('Failed to fetch'), 'network'],
      [new Response('no', { status: 404 }), 'http'],
      [Response.json({ ...MANIFEST, file: 'otro.pmtiles' }), 'format'],
      [new Response('no es json', { status: 200 }), 'format'],
    ];
    for (const [response, reason] of cases) {
      const error = await loadBasemap(API, fetchReturning(response)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BasemapError);
      expect((error as BasemapError).reason).toBe(reason);
      expect((error as BasemapError).message).toBe(BASEMAP_ERROR_MESSAGE);
    }
  });

  it('una petición cancelada no se convierte en error del mapa', async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException('cancelada', 'AbortError');
    await expect(loadBasemap(API, fetchReturning(abort), controller.signal)).rejects.toBe(abort);
  });
});

describe('estilo y vista del mapa', () => {
  const urls = {
    tilesUrl: `${API}/tiles/panter-20261118.pmtiles`,
    glyphsUrl: `${API}/tiles/fonts/{fontstack}/{range}.pbf`,
    spriteUrl: `${API}/tiles/sprites/v4`,
  };

  it('estilo de map-style con pmtiles://, sprites del tema y los puntos clave', () => {
    const light = panterStyle(urls, 'light');
    const dark = panterStyle(urls, 'dark');
    const source = light.sources[BASEMAP_SOURCE] as { url: string };
    expect(source.url).toBe(`pmtiles://${API}/tiles/panter-20261118.pmtiles`);
    expect(light.sprite).toBe(`${API}/tiles/sprites/v4/light`);
    expect(dark.sprite).toBe(`${API}/tiles/sprites/v4/dark`);
    expect(light.glyphs).toBe(urls.glyphsUrl);
    expect(light.layers.at(-1)?.id).toBe(PLACES_LAYER);
  });

  it('centro en Villagarzón y límites en el área de servicio', () => {
    expect(MAP_VIEW.center).toEqual([PLACES.VILLAGARZON_CENTER.lng, PLACES.VILLAGARZON_CENTER.lat]);
    expect(MAP_VIEW.maxBounds).toEqual([
      [SERVICE_AREA.west, SERVICE_AREA.south],
      [SERVICE_AREA.east, SERVICE_AREA.north],
    ]);
  });

  it('controles de zoom en español', () => {
    expect(MAP_LOCALE_ES['NavigationControl.ZoomIn']).toBe('Acercar');
    expect(MAP_LOCALE_ES['NavigationControl.ZoomOut']).toBe('Alejar');
  });
});
