import { describe, expect, it, vi } from 'vitest';
import { networkError } from '../../shared/api/errors';
import type { CatalogApi } from './api/catalog-api';
import { CATALOG_KEYS, type CatalogStorage, createCatalogRepository } from './catalog-repository';
import { AREAS, makeArea, PLACES_CATALOG } from './test-helpers';

function memoryStorage(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const storage: CatalogStorage & { files: Map<string, string> } = {
    files,
    read: async (key) => files.get(key) ?? null,
    write: async (key, text) => {
      files.set(key, text);
    },
  };
  return storage;
}

function fakeApi(overrides: Partial<CatalogApi> = {}): CatalogApi {
  return {
    listAreas: vi.fn(async () => ({ items: AREAS })),
    getArea: vi.fn(async (id: string) => makeArea({ id })),
    locateArea: vi.fn(async () => ({ area: null })),
    listPlaces: vi.fn(async () => ({ items: PLACES_CATALOG })),
    nearbyPlaces: vi.fn(async () => ({ items: [] })),
    ...overrides,
  };
}

const offline = () => Promise.reject(networkError(new TypeError('Network request failed')));
const NOW = () => new Date('2026-11-21T13:00:00.000Z');

describe('catálogo con copia en el teléfono', () => {
  it('con señal: responde de la red y guarda la respuesta', async () => {
    const storage = memoryStorage();
    const repo = createCatalogRepository({ api: fakeApi(), storage, now: NOW });
    const areas = await repo.areas();
    expect(areas).toMatchObject({ source: 'network', savedAt: '2026-11-21T13:00:00.000Z' });
    expect(areas.items).toEqual(AREAS);
    expect(JSON.parse(storage.files.get(CATALOG_KEYS.AREAS)!)).toEqual({
      savedAt: '2026-11-21T13:00:00.000Z',
      data: { items: AREAS },
    });
    await repo.places();
    expect(storage.files.has(CATALOG_KEYS.PLACES)).toBe(true);
  });

  it('sin señal: usa la última copia guardada', async () => {
    const storage = memoryStorage();
    await createCatalogRepository({ api: fakeApi(), storage, now: NOW }).places();

    const repo = createCatalogRepository({
      api: fakeApi({ listPlaces: offline, listAreas: offline }),
      storage,
    });
    const places = await repo.places();
    expect(places.source).toBe('cache');
    expect(places.savedAt).toBe('2026-11-21T13:00:00.000Z');
    expect(places.items.map((p) => p.slug)).toContain('rio-guineo');
    expect(await repo.knownPlaces()).toHaveLength(PLACES_CATALOG.length);
  });

  it('sin señal y sin copia: el error original, y el siguiente intento vuelve a pedir', async () => {
    const listAreas = vi.fn(offline);
    const repo = createCatalogRepository({ api: fakeApi({ listAreas }), storage: memoryStorage() });
    await expect(repo.areas()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await expect(repo.areas()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(listAreas).toHaveBeenCalledTimes(2);
  });

  it('una copia dañada o fuera del contrato no se usa', async () => {
    const api = fakeApi({ listAreas: offline, listPlaces: offline });
    const damaged = createCatalogRepository({
      api,
      storage: memoryStorage({ [CATALOG_KEYS.AREAS]: '{no es json' }),
    });
    await expect(damaged.areas()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    const invalid = createCatalogRepository({
      api,
      storage: memoryStorage({
        [CATALOG_KEYS.PLACES]: JSON.stringify({ savedAt: 'x', data: { items: [{ id: 1 }] } }),
      }),
    });
    await expect(invalid.places()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('consulta la lista una vez por sesión; refresh vuelve a pedir', async () => {
    const api = fakeApi();
    const repo = createCatalogRepository({ api, storage: memoryStorage() });
    await repo.areas();
    await repo.areas();
    expect(api.listAreas).toHaveBeenCalledTimes(1);
    await repo.areas({ refresh: true });
    expect(api.listAreas).toHaveBeenCalledTimes(2);
  });

  it('si no se puede guardar la copia, la respuesta igual sirve', async () => {
    const storage = memoryStorage();
    storage.write = async () => {
      throw new Error('Sin espacio');
    };
    const repo = createCatalogRepository({ api: fakeApi(), storage });
    expect((await repo.areas()).source).toBe('network');
  });

  it('el croquis de un barrio queda guardado para usarlo sin señal', async () => {
    const storage = memoryStorage();
    const centro = AREAS[0]!.id;
    await createCatalogRepository({ api: fakeApi(), storage }).area(centro);

    const repo = createCatalogRepository({ api: fakeApi({ getArea: offline }), storage });
    expect((await repo.area(centro)).polygon[0]).toHaveLength(4);
    expect((await repo.knownAreas()).map((a) => a.id)).toEqual([centro]);
    await expect(repo.area(AREAS[1]!.id)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
