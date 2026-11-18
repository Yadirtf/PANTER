import { SERVICE_AREA } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import script from '../../../../../scripts/generar_mapa.sh?raw';
import {
  contentRange,
  etagMatches,
  resolveRange,
  unsatisfiedRange,
} from '../../../src/modules/tiles/domain/http-range';
import {
  basemapFileName,
  cacheControl,
  GLYPH_FONTS,
  maxAgeSeconds,
  resolveTileFile,
} from '../../../src/modules/tiles/domain/tile-file';

describe('resolveTileFile (lista blanca)', () => {
  it('acepta el manifiesto y el extracto versionado por fecha', () => {
    expect(resolveTileFile('basemap.json')).toMatchObject({ policy: 'manifest' });
    expect(resolveTileFile(basemapFileName('20261117'))).toEqual({
      key: 'panter-20261117.pmtiles',
      contentType: 'application/octet-stream',
      policy: 'immutable',
      emptyIfMissing: false,
    });
    expect(resolveTileFile('panter-20240229.pmtiles')).not.toBeNull();
  });

  it('rechaza fechas imposibles en el nombre del extracto', () => {
    expect(resolveTileFile('panter-20261301.pmtiles')).toBeNull();
    expect(resolveTileFile('panter-20250229.pmtiles')).toBeNull();
    expect(resolveTileFile('panter-20261100.pmtiles')).toBeNull();
    expect(resolveTileFile('panter-19991231.pmtiles')).toBeNull();
  });

  it('acepta los rangos de glifos de las fuentes del estilo', () => {
    for (const font of GLYPH_FONTS) {
      expect(resolveTileFile(`fonts/${font}/0-255.pbf`)).toMatchObject({
        contentType: 'application/x-protobuf',
        policy: 'asset',
        emptyIfMissing: true,
      });
    }
    expect(resolveTileFile('fonts/Noto Sans Regular/65280-65535.pbf')).not.toBeNull();
  });

  it('rechaza fuentes desconocidas y rangos mal alineados', () => {
    expect(resolveTileFile('fonts/Comic Sans/0-255.pbf')).toBeNull();
    expect(resolveTileFile('fonts/Noto Sans Regular/1-256.pbf')).toBeNull();
    expect(resolveTileFile('fonts/Noto Sans Regular/0-511.pbf')).toBeNull();
    expect(resolveTileFile('fonts/Noto Sans Regular/65536-65791.pbf')).toBeNull();
    expect(resolveTileFile('fonts/Noto Sans Regular,Noto Sans Medium/0-255.pbf')).toBeNull();
  });

  it('acepta los sprites claro y oscuro en 1x y 2x', () => {
    expect(resolveTileFile('sprites/v4/light.json')).toMatchObject({
      contentType: 'application/json',
    });
    expect(resolveTileFile('sprites/v4/dark@2x.png')).toMatchObject({ contentType: 'image/png' });
    expect(resolveTileFile('sprites/v4/white.json')).toBeNull();
    expect(resolveTileFile('sprites/v3/light.json')).toBeNull();
  });

  it('bloquea path traversal y cualquier otra clave del bucket', () => {
    for (const path of [
      '',
      '../panter-documents/cedula.pdf',
      'fonts/../basemap.json',
      'fonts/Noto Sans Regular/../../secret.pbf',
      '..%2fbasemap.json',
      '/basemap.json',
      'basemap.json/',
      'sprites\\v4\\light.json',
      'panter-20261117.pmtiles.bak',
      'otro.pmtiles',
      `${'a'.repeat(200)}.pmtiles`,
    ]) {
      expect(resolveTileFile(path), path).toBeNull();
    }
  });
});

describe('políticas de caché', () => {
  it('el extracto versionado es inmutable por un año y el manifiesto dura 5 minutos', () => {
    expect(cacheControl('immutable')).toBe('public, max-age=31536000, immutable');
    expect(cacheControl('manifest')).toBe('public, max-age=300');
    expect(cacheControl('asset')).toContain('max-age=604800');
    expect(maxAgeSeconds('immutable')).toBe(31_536_000);
    expect(maxAgeSeconds('asset')).toBe(604_800);
    expect(maxAgeSeconds('manifest')).toBe(300);
  });
});

describe('resolveRange', () => {
  const size = 1000;

  it('sin cabecera o mal formada sirve el archivo completo', () => {
    expect(resolveRange(null, size)).toEqual({ kind: 'full' });
    expect(resolveRange(undefined, size)).toEqual({ kind: 'full' });
    expect(resolveRange('items=0-10', size)).toEqual({ kind: 'full' });
    expect(resolveRange('bytes=0-1,5-9', size)).toEqual({ kind: 'full' });
    expect(resolveRange('bytes=-', size)).toEqual({ kind: 'full' });
    expect(resolveRange('bytes=10-5', size)).toEqual({ kind: 'full' });
  });

  it('rango cerrado, abierto y sufijo', () => {
    expect(resolveRange('bytes=0-16383', 20000)).toEqual({
      kind: 'partial',
      range: { offset: 0, length: 16384 },
    });
    expect(resolveRange('bytes=990-', size)).toEqual({
      kind: 'partial',
      range: { offset: 990, length: 10 },
    });
    expect(resolveRange('bytes=-100', size)).toEqual({
      kind: 'partial',
      range: { offset: 900, length: 100 },
    });
    expect(resolveRange('BYTES=1-1', size)).toEqual({
      kind: 'partial',
      range: { offset: 1, length: 1 },
    });
  });

  it('recorta el final que pasa del tamaño (PMTiles pide 16 KB aunque el archivo sea menor)', () => {
    expect(resolveRange('bytes=0-16383', size)).toEqual({
      kind: 'partial',
      range: { offset: 0, length: size },
    });
    expect(resolveRange('bytes=-5000', size)).toEqual({
      kind: 'partial',
      range: { offset: 0, length: size },
    });
  });

  it('inicio en o después del final, o sufijo cero: no satisfacible', () => {
    expect(resolveRange('bytes=1000-', size)).toEqual({ kind: 'unsatisfiable' });
    expect(resolveRange('bytes=5000-6000', size)).toEqual({ kind: 'unsatisfiable' });
    expect(resolveRange('bytes=-0', size)).toEqual({ kind: 'unsatisfiable' });
    expect(resolveRange('bytes=0-10', 0)).toEqual({ kind: 'unsatisfiable' });
    expect(resolveRange('bytes=-10', 0)).toEqual({ kind: 'unsatisfiable' });
  });

  it('formatea Content-Range', () => {
    expect(contentRange({ offset: 0, length: 16384 }, 50000)).toBe('bytes 0-16383/50000');
    expect(unsatisfiedRange(50000)).toBe('bytes */50000');
  });
});

describe('etagMatches (If-None-Match)', () => {
  it('compara de forma débil, en listas y con *', () => {
    expect(etagMatches('"abc"', '"abc"')).toBe(true);
    expect(etagMatches('W/"abc"', '"abc"')).toBe(true);
    expect(etagMatches('"x", "abc"', '"abc"')).toBe(true);
    expect(etagMatches('*', '"abc"')).toBe(true);
    expect(etagMatches('"abd"', '"abc"')).toBe(false);
    expect(etagMatches('', '"abc"')).toBe(false);
    expect(etagMatches(null, '"abc"')).toBe(false);
  });
});

describe('scripts/generar_mapa.sh', () => {
  it('extrae por defecto exactamente la caja SERVICE_AREA de contracts', () => {
    const match = /^SERVICE_AREA_BBOX="([^"]+)"$/m.exec(script);
    expect(match?.[1]).toBe(
      [SERVICE_AREA.west, SERVICE_AREA.south, SERVICE_AREA.east, SERVICE_AREA.north].join(','),
    );
    expect(script).toMatch(/^maxzoom=15$/m);
  });

  it('sube las mismas fuentes que acepta la lista blanca', () => {
    const match = /^FONTS=\((.+)\)$/m.exec(script);
    const fonts = [...(match?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(fonts).toEqual([...GLYPH_FONTS]);
    const ranges = /^GLYPH_RANGES=\((.+)\)$/m.exec(script)?.[1] ?? '';
    for (const range of ranges.matchAll(/"([^"]+)"/g)) {
      expect(resolveTileFile(`fonts/${GLYPH_FONTS[0]}/${range[1]}.pbf`), range[1]).not.toBeNull();
    }
  });
});
