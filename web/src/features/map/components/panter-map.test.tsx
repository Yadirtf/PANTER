import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DispatchConsole,
  FLEET_PENDING_NOTE,
} from '@/features/dispatch/components/dispatch-console';
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
  it('mapa de despacho con los lugares clave y aviso de la flota de HU-504', () => {
    const html = renderToString(<DispatchConsole />);
    expect(html).toContain('data-panter-map="Mapa de despacho de Villagarzón"');
    for (const place of ['Aeropuerto Cananguchal', 'Parque principal', 'Pozo Azul', 'Mohano']) {
      expect(html).toContain(place);
    }
    expect(html).toContain('Ubicación aproximada, por verificar en campo');
    expect(html).toContain(FLEET_PENDING_NOTE);
  });
});
