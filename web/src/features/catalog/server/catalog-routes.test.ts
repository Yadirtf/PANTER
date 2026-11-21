import { ApiErrorCode, type TokenPairResponse } from '@panter/contracts';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/features/auth/server/cookies';
import { API_URL, apiError, jsonResponse, WEB_ORIGIN } from '@/features/auth/server/test-helpers';
import { mockFetch, type Handler } from '@/features/drivers/server/drivers-test-data';
import { AREA_DETAILS_MAX_IDS } from '../lib/limits';
import { createCatalogApi } from './catalog-api';
import {
  handleAreaDetails,
  handleAreaHistory,
  handleCreateArea,
  handleImportAreas,
  handleUpdateArea,
  parseIds,
} from './catalog-routes';
import { AREA_CHANGE, CENTRO, CENTRO_ID, SAN_JOSE, SAN_JOSE_ID } from './catalog-test-data';

const ACCESS = 'eyJhbGciOiJSUzI1NiJ9.access-del-admin.firma';
const REFRESH = 'rt-secreto-de-la-cookie';

function setup(routes: Record<string, Handler | Handler[]>) {
  const fetchMock = mockFetch(routes);
  const refresh = vi.fn<(token: string) => Promise<TokenPairResponse>>(() =>
    Promise.reject(new Error('refresh no esperado')),
  );
  return {
    fetchMock,
    deps: { catalog: createCatalogApi({ apiUrl: API_URL, fetch: fetchMock }), refresh },
  };
}

function request(
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): NextRequest {
  return new NextRequest(new URL(path, WEB_ORIGIN), {
    method,
    headers: {
      host: new URL(WEB_ORIGIN).host,
      origin: WEB_ORIGIN,
      'sec-fetch-site': 'same-origin',
      cookie: `${ACCESS_COOKIE}=${ACCESS}; ${REFRESH_COOKIE}=${REFRESH}`,
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

const init = (fetchMock: ReturnType<typeof mockFetch>, call = 0) => fetchMock.mock.calls[call]![1]!;
const authorization = (fetchMock: ReturnType<typeof mockFetch>, call = 0) =>
  (init(fetchMock, call).headers as Record<string, string>).authorization;
const sentBody = (fetchMock: ReturnType<typeof mockFetch>, call = 0) =>
  JSON.parse(String(init(fetchMock, call).body)) as unknown;

const createBody = {
  name: 'La Esperanza',
  kind: 'BARRIO',
  source: 'Dibujado por ADMIN en /admin/barrios',
  polygon: CENTRO.polygon,
};

describe('POST /api/admin/areas', () => {
  it('valida con AreaCreateBodySchema y reenvía el cuerpo con Bearer; el token no vuelve', async () => {
    const { fetchMock, deps } = setup({
      'POST /admin/areas': () => jsonResponse({ ...CENTRO, name: 'La Esperanza' }, 201),
    });
    const response = await handleCreateArea(request('POST', '/x', { body: createBody }), deps);
    expect(response.status).toBe(200);
    expect(authorization(fetchMock)).toBe(`Bearer ${ACCESS}`);
    expect(sentBody(fetchMock)).toEqual(createBody);
    const text = await response.text();
    expect(text).not.toContain(ACCESS);
    expect(JSON.parse(text)).toMatchObject({ name: 'La Esperanza' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rechaza un cuerpo fuera del contrato sin llamar a la API', async () => {
    const { fetchMock, deps } = setup({});
    for (const body of [
      { ...createBody, name: 'X' },
      { ...createBody, kind: 'COMUNA' },
      { ...createBody, polygon: [[{ lat: 1, lng: -76.6 }]] },
    ]) {
      const response = await handleCreateArea(request('POST', '/x', { body }), deps);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pasa AREA_NAME_TAKEN (409) e INVALID_POLYGON (400, con su motivo) al navegador', async () => {
    const invalid = () =>
      jsonResponse(
        {
          error: {
            code: ApiErrorCode.INVALID_POLYGON,
            message: 'Polígono inválido',
            details: { reason: 'Self-intersection[-76.615 1.03]' },
          },
        },
        400,
      );
    const { deps } = setup({
      'POST /admin/areas': [
        () => apiError(409, ApiErrorCode.AREA_NAME_TAKEN, 'Nombre en uso'),
        invalid,
      ],
    });
    const taken = await handleCreateArea(request('POST', '/x', { body: createBody }), deps);
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.code).toBe(ApiErrorCode.AREA_NAME_TAKEN);
    const rejected = await handleCreateArea(request('POST', '/x', { body: createBody }), deps);
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toEqual({
      code: ApiErrorCode.INVALID_POLYGON,
      message: 'Polígono inválido',
      details: { reason: 'Self-intersection[-76.615 1.03]' },
    });
  });

  it('rechaza peticiones de otro sitio', async () => {
    const { fetchMock, deps } = setup({});
    const response = await handleCreateArea(
      request('POST', '/x', {
        body: createBody,
        headers: { origin: 'https://otro.example', 'sec-fetch-site': 'cross-site' },
      }),
      deps,
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/areas/:id', () => {
  it('reenvía solo los campos enviados (desactivar) a /admin/areas/:id', async () => {
    const { fetchMock, deps } = setup({
      [`PATCH /admin/areas/${CENTRO_ID}`]: () => jsonResponse({ ...CENTRO, active: false }),
    });
    const response = await handleUpdateArea(
      request('PATCH', '/x', { body: { active: false } }),
      CENTRO_ID,
      deps,
    );
    expect(response.status).toBe(200);
    expect(sentBody(fetchMock)).toEqual({ active: false });
    expect(init(fetchMock).method).toBe('PATCH');
  });

  it('id que no es UUID: 404 sin llamar a la API', async () => {
    const { fetchMock, deps } = setup({});
    const response = await handleUpdateArea(
      request('PATCH', '/x', { body: { active: true } }),
      '../fares',
      deps,
    );
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/areas/import', () => {
  const geojson = { type: 'FeatureCollection', features: [{ type: 'Feature' }] };

  it('dryRun por defecto (vista previa) y BARRIO como tipo por defecto', async () => {
    const result = { dryRun: true, valid: [], errors: [], saved: 0 };
    const { fetchMock, deps } = setup({ 'POST /admin/areas/import': () => jsonResponse(result) });
    const response = await handleImportAreas(
      request('POST', '/x', { body: { geojson, nameProperty: 'NOMBRE' } }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(sentBody(fetchMock)).toEqual({
      geojson,
      nameProperty: 'NOMBRE',
      defaultKind: 'BARRIO',
      dryRun: true,
    });
    expect(await response.json()).toEqual(result);
  });

  it('más features que AREA_IMPORT_MAX_FEATURES: 400 sin llamar a la API', async () => {
    const { fetchMock, deps } = setup({});
    const many = { type: 'FeatureCollection', features: Array.from({ length: 501 }, () => ({})) };
    const response = await handleImportAreas(
      request('POST', '/x', { body: { geojson: many } }),
      deps,
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/areas/details?ids=', () => {
  it('pide cada polígono con Bearer y separa los que ya no existen', async () => {
    const gone = '7d2e9b3f-1c8a-4e5b-8f60-2b3c4d5e6f99';
    const { fetchMock, deps } = setup({
      [`GET /areas/${CENTRO_ID}`]: () => jsonResponse(CENTRO),
      [`GET /areas/${SAN_JOSE_ID}`]: () => jsonResponse(SAN_JOSE),
      [`GET /areas/${gone}`]: () => apiError(404, ApiErrorCode.NOT_FOUND),
    });
    const response = await handleAreaDetails(
      request('GET', `/x?ids=${CENTRO_ID},${SAN_JOSE_ID},${gone},${CENTRO_ID}`),
      deps,
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(authorization(fetchMock, 2)).toBe(`Bearer ${ACCESS}`);
    const body = await response.json();
    expect(body.items.map((a: { id: string }) => a.id)).toEqual([CENTRO_ID, SAN_JOSE_ID]);
    expect(body.missing).toEqual([gone]);
  });

  it(`entre 1 y ${AREA_DETAILS_MAX_IDS} UUID por petición`, async () => {
    expect(parseIds(null)).toBeNull();
    expect(parseIds('no-es-uuid')).toBeNull();
    expect(
      parseIds(Array.from({ length: AREA_DETAILS_MAX_IDS + 1 }, () => CENTRO_ID).join(',')),
    ).toEqual([CENTRO_ID]);
    const { fetchMock, deps } = setup({});
    const response = await handleAreaDetails(request('GET', '/x?ids='), deps);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('otro error de la API (p. ej. 403) se propaga', async () => {
    const { deps } = setup({
      [`GET /areas/${CENTRO_ID}`]: () => apiError(403, ApiErrorCode.FORBIDDEN),
    });
    const response = await handleAreaDetails(request('GET', `/x?ids=${CENTRO_ID}`), deps);
    expect(response.status).toBe(403);
  });
});

describe('GET /api/admin/areas/:id/history', () => {
  it('reenvía el cursor a /admin/areas/:id/history', async () => {
    const { fetchMock, deps } = setup({
      [`GET /admin/areas/${CENTRO_ID}/history`]: () =>
        jsonResponse({ items: [AREA_CHANGE], nextCursor: null }),
    });
    const response = await handleAreaHistory(request('GET', '/x?cursor=c2'), CENTRO_ID, deps);
    expect(response.status).toBe(200);
    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('cursor')).toBe('c2');
    expect((await response.json()).items).toHaveLength(1);
  });
});
