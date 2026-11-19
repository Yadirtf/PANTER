import { describe, expect, it } from 'vitest';
import { createHttpClient } from '../../../shared/api/http-client';
import { apiError, BASE_URL, fakeFetch, jsonResponse } from '../../../test/fake-api';
import { makeDocument, makeProfile, signedUrl } from '../test-helpers';
import { parsePutResponse } from '../upload/put-response';
import { createDriversApi } from './drivers-api';

function setup(route: Parameters<typeof fakeFetch>[0]) {
  const fetch = fakeFetch(route);
  const http = createHttpClient({ baseUrl: BASE_URL, fetch });
  http.setAuthHandler({
    getAccessToken: async () => 'access-1',
    refreshAccessToken: async () => 'access-2',
  });
  return { api: createDriversApi(http), fetch };
}

describe('DriversApi (API simulada)', () => {
  it('POST /drivers/apply con el vehículo y token', async () => {
    const profile = makeProfile();
    const { api, fetch } = setup(() => jsonResponse(201, profile));
    const body = {
      vehicleType: 'MOTOTAXI',
      plate: 'ABC12D',
      brand: 'Bajaj',
      model: 'RE 4S',
      color: 'Verde',
      year: 2022,
    } as const;
    await expect(api.apply(body)).resolves.toEqual(profile);
    expect(fetch.calls[0]).toMatchObject({
      method: 'POST',
      path: '/drivers/apply',
      body,
      headers: { Authorization: 'Bearer access-1' },
    });
  });

  it('propaga PLATE_ALREADY_REGISTERED', async () => {
    const { api } = setup(() => apiError(409, 'PLATE_ALREADY_REGISTERED'));
    await expect(
      api.apply({
        vehicleType: 'TAXI',
        plate: 'ABC123',
        brand: 'Chevrolet',
        model: 'Spark',
        color: 'Amarillo',
        year: 2020,
      }),
    ).rejects.toMatchObject({ code: 'PLATE_ALREADY_REGISTERED', status: 409 });
  });

  it('GET /drivers/me devuelve null si aún no hay solicitud', async () => {
    expect(await setup(() => apiError(404, 'DRIVER_NOT_APPLIED')).api.getMe()).toBeNull();
    expect(await setup(() => apiError(404, 'NOT_FOUND')).api.getMe()).toBeNull();
    await expect(setup(() => apiError(500, 'INTERNAL_ERROR')).api.getMe()).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('pide la URL firmada del documento', async () => {
    const { api, fetch } = setup(() => jsonResponse(200, signedUrl('SOAT', 1)));
    await expect(
      api.requestUploadUrl('SOAT', { contentType: 'image/jpeg', sizeBytes: 300_000 }),
    ).resolves.toEqual(signedUrl('SOAT', 1));
    expect(fetch.calls[0]).toMatchObject({
      method: 'POST',
      path: '/drivers/me/documents/SOAT/upload-url',
      body: { contentType: 'image/jpeg', sizeBytes: 300_000 },
    });
  });
});

describe('parsePutResponse', () => {
  it('200 con DriverDocument', () => {
    const document = makeDocument('CEDULA');
    expect(parsePutResponse(200, JSON.stringify(document))).toEqual(document);
  });

  it('error uniforme de la API', () => {
    expect(() =>
      parsePutResponse(
        403,
        JSON.stringify({ error: { code: 'UPLOAD_URL_INVALID', message: 'x' } }),
      ),
    ).toThrow(expect.objectContaining({ code: 'UPLOAD_URL_INVALID', status: 403 }));
  });

  it('sin cuerpo deduce el código del estado HTTP', () => {
    expect(() => parsePutResponse(403, '')).toThrow(
      expect.objectContaining({ code: 'UPLOAD_URL_INVALID' }),
    );
    expect(() => parsePutResponse(413, '')).toThrow(
      expect.objectContaining({ code: 'DOCUMENT_TOO_LARGE' }),
    );
    expect(() => parsePutResponse(415, '')).toThrow(
      expect.objectContaining({ code: 'DOCUMENT_TYPE_NOT_ALLOWED' }),
    );
    expect(() => parsePutResponse(502, '<html>')).toThrow(
      expect.objectContaining({ code: 'INTERNAL_ERROR' }),
    );
  });

  it('200 que no cumple el contrato → INVALID_RESPONSE', () => {
    expect(() => parsePutResponse(200, '{}')).toThrow(
      expect.objectContaining({ code: 'INVALID_RESPONSE' }),
    );
  });
});
