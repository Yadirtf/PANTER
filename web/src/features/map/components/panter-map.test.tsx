import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { API_URL, apiError, jsonResponse } from '@/features/auth/server/test-helpers';
import { createCatalogApi } from '@/features/catalog/server/catalog-api';
import { AIRPORT_PLACE, PARK_PLACE, POZO_AZUL } from '@/features/catalog/server/catalog-test-data';
import { loadPublicPlaces } from '@/features/catalog/server/load-catalog';
import {
  DispatchConsole,
  FLEET_PENDING_NOTE,
  PLACES_UNAVAILABLE_NOTE,
  UNVERIFIED_NOTE,
} from '@/features/dispatch/components/dispatch-console';
import { mockFetch } from '@/features/drivers/server/drivers-test-data';
import { MAP_LOADING_TEXT } from './map-loading';
import { MarkerLayer } from './marker-layer';
import { PanterMap } from './panter-map';

const SRC = fileURLToPath(new URL('../../../', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('<PanterMap> en el servidor', () => {
  it('solo el contenedor accesible y "Cargando el mapa…": maplibre se carga en el navegador', () => {
    const html = renderToString(
      <PanterMap ariaLabel="Mapa de prueba" className="h-64">
        <MarkerLayer markers={[]} />
      </PanterMap>,
    );
    expect(html).toContain('data-panter-map="Mapa de prueba"');
    expect(html).toContain('h-64');
    expect(html).toContain(MAP_LOADING_TEXT);
    expect(html).not.toContain('maplibregl');
    expect(html).not.toContain('<canvas');
  });

  it('maplibre-gl y pmtiles solo se importan (en tiempo de ejecución) desde map-canvas.tsx', () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      const code = readFileSync(file, 'utf8');
      const runtime =
        /^import\s+(?!type\b)[^;]*from\s+'(maplibre-gl|pmtiles)'/m.test(code) ||
        /^import\s+'maplibre-gl[^']*'/m.test(code);
      return runtime && !file.endsWith(join('map', 'components', 'map-canvas.tsx'));
    });
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
    // Y map-canvas solo se carga con import dinámico sin SSR.
    const wrapper = readFileSync(join(SRC, 'features/map/components/panter-map.tsx'), 'utf8');
    expect(wrapper).toContain("import('./map-canvas')");
    expect(wrapper).toContain('ssr: false');
  });
});

describe('/despacho', () => {
  it('mapa de despacho con los lugares del catálogo (no los fijos) y aviso de la flota', () => {
    const html = renderToString(
      <DispatchConsole places={{ kind: 'ok', places: [AIRPORT_PLACE, PARK_PLACE, POZO_AZUL] }} />,
    );
    expect(html).toContain('data-panter-map="Mapa de despacho de Villagarzón"');
    for (const place of ['Aeropuerto Cananguchal', 'Parque principal', 'Pozo Azul']) {
      expect(html).toContain(place);
    }
    // Mohano sigue en map-style (KEY_PLACES), pero ya no se muestra: no vino de GET /places.
    expect(html).not.toContain('Mohano');
    // Solo los no verificados llevan el aviso (el aeropuerto está verificado).
    expect(html.split(UNVERIFIED_NOTE)).toHaveLength(3);
    expect(html).toContain(FLEET_PENDING_NOTE);
  });

  it('si GET /places falla, el mapa sigue y hay un aviso', () => {
    const html = renderToString(
      <DispatchConsole places={{ kind: 'error', code: 'NETWORK_ERROR' }} />,
    );
    expect(html).toContain('data-panter-map="Mapa de despacho de Villagarzón"');
    expect(html).toContain(PLACES_UNAVAILABLE_NOTE);
  });

  it('la página lee GET /places en el servidor, sin token (es público)', async () => {
    const fetchMock = mockFetch({
      'GET /places': () => jsonResponse({ items: [AIRPORT_PLACE] }),
    });
    const load = await loadPublicPlaces(createCatalogApi({ apiUrl: API_URL, fetch: fetchMock }));
    expect(load).toEqual({ kind: 'ok', places: [AIRPORT_PLACE] });
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.headers as Record<string, string>).not.toHaveProperty('authorization');
    const failed = await loadPublicPlaces(
      createCatalogApi({
        apiUrl: API_URL,
        fetch: mockFetch({ 'GET /places': () => apiError(500, 'INTERNAL_ERROR') }),
      }),
    );
    expect(failed).toEqual({ kind: 'error', code: 'INTERNAL_ERROR' });
  });
});
