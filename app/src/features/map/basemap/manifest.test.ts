import type { BasemapManifest } from '@panter/map-style';
import { describe, expect, it } from 'vitest';
import { createHttpClient } from '../../../shared/api/http-client';
import { fakeFetch, jsonResponse } from '../../../test/fake-api';
import { API_URL, makeManifest } from '../test-helpers';
import { BasemapManifestSchema, isNewerBuild, loadManifest, type ManifestCache } from './manifest';

function memoryCache(initial: BasemapManifest | null = null) {
  let value = initial;
  const cache: ManifestCache & { value: () => BasemapManifest | null } = {
    load: async () => value,
    save: async (m) => {
      value = m;
    },
    value: () => value,
  };
  return cache;
}

describe('BasemapManifestSchema', () => {
  it('acepta el manifiesto publicado y rechaza uno mal formado', () => {
    expect(BasemapManifestSchema.safeParse(makeManifest()).success).toBe(true);
    expect(BasemapManifestSchema.safeParse({ file: 'otro.pmtiles' }).success).toBe(false);
    expect(BasemapManifestSchema.safeParse(null).success).toBe(false);
  });
});

describe('loadManifest', () => {
  it('pide /tiles/basemap.json sin autenticación y guarda la copia', async () => {
    const fetch = fakeFetch(() => jsonResponse(200, makeManifest()));
    const cache = memoryCache();
    const result = await loadManifest(createHttpClient({ baseUrl: API_URL, fetch }), cache);
    expect(fetch.calls[0]).toMatchObject({ method: 'GET', path: '/tiles/basemap.json' });
    expect(fetch.calls[0]!.headers.Authorization).toBeUndefined();
    expect(result).toMatchObject({ fresh: true, error: null, manifest: { build: '20261118' } });
    expect(cache.value()?.file).toBe('panter-20261118.pmtiles');
  });

  it('sin red usa la última copia guardada', async () => {
    const fetch = fakeFetch(() => {
      throw new TypeError('Network request failed');
    });
    const cache = memoryCache(makeManifest({ build: '20261101', file: 'panter-20261101.pmtiles' }));
    const result = await loadManifest(createHttpClient({ baseUrl: API_URL, fetch }), cache);
    expect(result.fresh).toBe(false);
    expect(result.manifest?.build).toBe('20261101');
    expect(result.error?.code).toBe('NETWORK_ERROR');
  });

  it('manifiesto inválido → error y sin copia', async () => {
    const fetch = fakeFetch(() => jsonResponse(200, { file: 'x' }));
    const result = await loadManifest(createHttpClient({ baseUrl: API_URL, fetch }), memoryCache());
    expect(result).toMatchObject({ manifest: null, fresh: false });
    expect(result.error?.code).toBe('INVALID_RESPONSE');
  });
});

describe('isNewerBuild', () => {
  it('detecta un build distinto al de la copia local', () => {
    const local = makeManifest();
    expect(isNewerBuild(local, makeManifest())).toBe(false);
    expect(
      isNewerBuild(local, makeManifest({ build: '20261202', file: 'panter-20261202.pmtiles' })),
    ).toBe(true);
    expect(isNewerBuild(null, makeManifest())).toBe(false);
  });
});
