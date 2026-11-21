import { describe, expect, it } from 'vitest';
import { createHttpClient } from '../../../shared/api/http-client';
import { apiError, BASE_URL, fakeFetch, jsonResponse } from '../../../test/fake-api';
import { AREAS, makeArea, makePlace } from '../test-helpers';
import { createCatalogApi } from './catalog-api';

function api(route: Parameters<typeof fakeFetch>[0]) {
  const fetch = fakeFetch(route);
  // Sin AuthHandler: si alguna consulta pidiera sesión fallaría con UNAUTHENTICATED.
  const http = createHttpClient({ baseUrl: BASE_URL, fetch });
  return { catalog: createCatalogApi(http), fetch };
}

const POINT = { lat: 1.0295, lng: -76.6165 };

describe('CatalogApi', () => {
  it('GET /areas público y validado con el contrato', async () => {
    const { catalog, fetch } = api(() => jsonResponse(200, { items: AREAS }));
    expect((await catalog.listAreas()).items).toHaveLength(AREAS.length);
    expect(fetch.calls[0]).toMatchObject({ method: 'GET', path: '/areas' });
    expect(fetch.calls[0]!.headers.Authorization).toBeUndefined();
  });

  it('GET /areas/:id con polígono', async () => {
    const area = makeArea();
    const { catalog, fetch } = api(() => jsonResponse(200, area));
    expect(await catalog.getArea(area.id)).toEqual(area);
    expect(fetch.calls[0]!.path).toBe(`/areas/${area.id}`);
  });

  it('GET /areas/locate y /places/nearby con lat y lng', async () => {
    const place = makePlace();
    const { catalog, fetch } = api((request) =>
      request.path.startsWith('/areas/locate')
        ? jsonResponse(200, { area: AREAS[0] })
        : jsonResponse(200, { items: [{ ...place, distanceMeters: 40 }] }),
    );
    expect((await catalog.locateArea(POINT)).area?.name).toBe('Centro');
    expect((await catalog.nearbyPlaces(POINT)).items[0]?.distanceMeters).toBe(40);
    expect(fetch.calls.map((c) => c.path)).toEqual([
      '/areas/locate?lat=1.0295&lng=-76.6165',
      '/places/nearby?lat=1.0295&lng=-76.6165&radiusMeters=300&limit=1',
    ]);
  });

  it('GET /places con el máximo de la página', async () => {
    const { catalog, fetch } = api(() => jsonResponse(200, { items: [makePlace()] }));
    expect((await catalog.listPlaces()).items[0]?.slug).toBe('aeropuerto-cananguchal');
    expect(fetch.calls[0]!.path).toBe('/places?limit=100');
  });

  it('respuesta fuera del contrato → INVALID_RESPONSE; error de la API con su código', async () => {
    const bad = api(() => jsonResponse(200, { items: [{ id: 'x' }] }));
    await expect(bad.catalog.listAreas()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const missing = api(() => apiError(404, 'NOT_FOUND'));
    await expect(missing.catalog.getArea(AREAS[0]!.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
