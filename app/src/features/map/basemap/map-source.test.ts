import { buildStyle } from '@panter/map-style';
import { describe, expect, it } from 'vitest';
import { API_URL, makeManifest } from '../test-helpers';
import { localBasemapUrls, offlineAssetPaths, resolveMapSource, tileAssetUrl } from './map-source';

const ROOT = 'file:///data/user/0/co.panter.app/files/offline-map/';
const local = { build: '20261101', file: 'panter-20261101.pmtiles', rootUri: ROOT };
const manifest = makeManifest();

describe('URLs del mapa base', () => {
  it('remotas: el .pmtiles vigente, glifos y sprites de /tiles', () => {
    const source = resolveMapSource({
      apiUrl: `${API_URL}/`,
      manifest,
      manifestFresh: true,
      online: true,
      local: null,
    });
    expect(source).toEqual({
      kind: 'remote',
      build: '20261118',
      urls: {
        tilesUrl: `${API_URL}/tiles/panter-20261118.pmtiles`,
        glyphsUrl: `${API_URL}/tiles/fonts/{fontstack}/{range}.pbf`,
        spriteUrl: `${API_URL}/tiles/sprites/v4`,
      },
    });
  });

  it('locales: pmtiles://file://… y archivos de la carpeta de la copia', () => {
    expect(localBasemapUrls(ROOT, 'panter-20261101.pmtiles')).toEqual({
      tilesUrl:
        'pmtiles://file:///data/user/0/co.panter.app/files/offline-map/panter-20261101.pmtiles',
      glyphsUrl:
        'file:///data/user/0/co.panter.app/files/offline-map/fonts/{fontstack}/{range}.pbf',
      spriteUrl: 'file:///data/user/0/co.panter.app/files/offline-map/sprites/v4',
    });
  });

  it('el estilo usa la fuente local tal cual (sin doble pmtiles://)', () => {
    const style = buildStyle({ ...localBasemapUrls(ROOT, local.file), theme: 'dark' });
    expect(style.sources.protomaps).toMatchObject({
      type: 'vector',
      url: `pmtiles://${ROOT}${local.file}`,
    });
    expect(style.sprite).toBe(`${ROOT}sprites/v4/dark`);
  });
});

describe('resolveMapSource', () => {
  it('sin red y con copia local → copia local', () => {
    expect(
      resolveMapSource({ apiUrl: API_URL, manifest, manifestFresh: false, online: false, local }),
    ).toMatchObject({ kind: 'local', build: '20261101' });
  });

  it('con red pero la API no respondió → copia local', () => {
    expect(
      resolveMapSource({ apiUrl: API_URL, manifest, manifestFresh: false, online: true, local }),
    ).toMatchObject({ kind: 'local' });
  });

  it('con red y manifiesto vigente → la API aunque haya copia local', () => {
    expect(
      resolveMapSource({ apiUrl: API_URL, manifest, manifestFresh: true, online: true, local }),
    ).toMatchObject({ kind: 'remote', build: '20261118' });
  });

  it('sin red ni copia, con el manifiesto guardado → la API (caché de MapLibre)', () => {
    expect(
      resolveMapSource({
        apiUrl: API_URL,
        manifest,
        manifestFresh: false,
        online: false,
        local: null,
      }),
    ).toMatchObject({ kind: 'remote' });
  });

  it('sin nada de dónde leer → no disponible, por falta de red o por error', () => {
    const base = { apiUrl: API_URL, manifest: null, manifestFresh: false, local: null };
    expect(resolveMapSource({ ...base, online: false })).toEqual({
      kind: 'unavailable',
      reason: 'offline',
    });
    expect(resolveMapSource({ ...base, online: true })).toEqual({
      kind: 'unavailable',
      reason: 'error',
    });
  });
});

describe('recursos para usar sin señal', () => {
  it('3 fuentes × 7 rangos de glifos y 8 sprites', () => {
    const paths = offlineAssetPaths();
    expect(paths).toHaveLength(29);
    expect(paths).toContain('fonts/Noto Sans Regular/0-255.pbf');
    expect(paths).toContain('fonts/Noto Sans Medium/8192-8447.pbf');
    expect(paths).toContain('sprites/v4/dark@2x.png');
    expect(paths).toContain('sprites/v4/light.json');
  });

  it('codifica los espacios de las fuentes en la URL', () => {
    expect(tileAssetUrl(`${API_URL}/`, 'fonts/Noto Sans Regular/0-255.pbf')).toBe(
      `${API_URL}/tiles/fonts/Noto%20Sans%20Regular/0-255.pbf`,
    );
  });
});
