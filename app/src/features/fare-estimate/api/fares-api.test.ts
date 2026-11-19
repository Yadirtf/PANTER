import { describe, expect, it } from 'vitest';
import { createHttpClient } from '../../../shared/api/http-client';
import { apiError, BASE_URL, fakeFetch, jsonResponse } from '../../../test/fake-api';
import { makeEstimate } from '../test-helpers';
import { createFaresApi } from './fares-api';

function api(route: Parameters<typeof fakeFetch>[0]) {
  const fetch = fakeFetch(route);
  const http = createHttpClient({ baseUrl: BASE_URL, fetch });
  http.setAuthHandler({
    getAccessToken: async () => 'access-1',
    refreshAccessToken: async () => 'access-2',
  });
  return { fares: createFaresApi(http), fetch };
}

const body = {
  origin: { lat: 1.0295, lng: -76.6165 },
  destination: { lat: 0.9789, lng: -76.6053 },
  vehicleType: 'TAXI' as const,
};

describe('FaresApi.estimate', () => {
  it('POST /fares/estimate autenticado y validado con el contrato', async () => {
    const { fares, fetch } = api(() => jsonResponse(200, makeEstimate()));
    const estimate = await fares.estimate(body);
    expect(estimate.total).toBe(19_500);
    expect(fetch.calls[0]).toMatchObject({
      method: 'POST',
      path: '/fares/estimate',
      body,
      headers: { Authorization: 'Bearer access-1' },
    });
  });

  it('ROUTING_UNAVAILABLE (503) llega con su código, sin precio', async () => {
    const { fares } = api(() => apiError(503, 'ROUTING_UNAVAILABLE'));
    await expect(fares.estimate(body)).rejects.toMatchObject({
      code: 'ROUTING_UNAVAILABLE',
      status: 503,
    });
  });

  it('respuesta fuera de contrato → INVALID_RESPONSE', async () => {
    const { fares } = api(() => jsonResponse(200, { total: 'mucho' }));
    await expect(fares.estimate(body)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
