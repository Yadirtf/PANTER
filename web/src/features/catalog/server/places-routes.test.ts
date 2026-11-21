import { ApiErrorCode, type TokenPairResponse } from '@panter/contracts';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/features/auth/server/cookies';
import { API_URL, apiError, jsonResponse, WEB_ORIGIN } from '@/features/auth/server/test-helpers';
import { mockFetch, type Handler } from '@/features/drivers/server/drivers-test-data';
import { CatalogBffRoutes, createPlace } from '../api/catalog-client';
import { catalogFailureMessage, placeFailureMessage } from '../lib/messages';
import { createCatalogApi } from './catalog-api';
import { handleCreatePlace, handlePlaceHistory, handleUpdatePlace } from './catalog-routes';
import { HOSPITAL, PARK_PLACE, PLACE_CHANGE, POZO_AZUL } from './catalog-test-data';

const ACCESS = 'eyJhbGciOiJSUzI1NiJ9.access-del-admin.firma';

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

function request(method: string, body?: unknown): NextRequest {
  return new NextRequest(new URL('/x?cursor=c3', WEB_ORIGIN), {
    method,
    headers: {
      host: new URL(WEB_ORIGIN).host,
      origin: WEB_ORIGIN,
      'sec-fetch-site': 'same-origin',
      cookie: `${ACCESS_COOKIE}=${ACCESS}; ${REFRESH_COOKIE}=rt`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const sent = (fetchMock: ReturnType<typeof mockFetch>) =>
  JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as unknown;

const createBody = {
  slug: 'hospital-local',
  name: 'Hospital local',
  category: 'HEALTH',
  location: HOSPITAL.location,
  pickupPoint: HOSPITAL.pickupPoint,
  verified: true,
  source: 'GPS en sitio',
};

describe('POST /api/admin/places', () => {
  it('valida con PlaceCreateBodySchema, reenvía con Bearer y devuelve el lugar con su barrio', async () => {
    const { fetchMock, deps } = setup({
      'POST /admin/places': () => jsonResponse({ ...HOSPITAL, active: true }, 201),
    });
    const response = await handleCreatePlace(request('POST', createBody), deps);
    expect(response.status).toBe(200);
    expect((fetchMock.mock.calls[0]![1]!.headers as Record<string, string>).authorization).toBe(
      `Bearer ${ACCESS}`,
    );
    expect(sent(fetchMock)).toEqual(createBody);
    const text = await response.text();
    expect(text).not.toContain(ACCESS);
    expect(JSON.parse(text).area).toEqual(HOSPITAL.area);
  });

  it('identificador con mayúsculas o espacios: 400 sin llamar a la API', async () => {
    const { fetchMock, deps } = setup({});
    const response = await handleCreatePlace(
      request('POST', { ...createBody, slug: 'Hospital Local' }),
      deps,
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PLACE_SLUG_TAKEN (409) llega al navegador y se muestra en español', async () => {
    const { deps } = setup({
      'POST /admin/places': () => apiError(409, ApiErrorCode.PLACE_SLUG_TAKEN, 'Slug en uso'),
    });
    const response = await handleCreatePlace(request('POST', createBody), deps);
    expect(response.status).toBe(409);
    const { error } = await response.json();
    expect(error.code).toBe(ApiErrorCode.PLACE_SLUG_TAKEN);
    expect(placeFailureMessage(error)).toBe(
      'Ya existe un lugar con ese identificador. Cambia el identificador (por ejemplo, agrega el barrio o la vereda).',
    );
  });
});

describe('PATCH /api/admin/places/:id', () => {
  it('reenvía los cambios; el identificador no se puede cambiar (no se reenvía)', async () => {
    const { fetchMock, deps } = setup({
      [`PATCH /admin/places/${POZO_AZUL.id}`]: () =>
        jsonResponse({ ...POZO_AZUL, verified: true, area: PARK_PLACE.area }),
    });
    const response = await handleUpdatePlace(
      request('PATCH', { slug: 'otro', verified: true, pickupPoint: null }),
      POZO_AZUL.id,
      deps,
    );
    expect(response.status).toBe(200);
    expect(sent(fetchMock)).toEqual({ verified: true, pickupPoint: null });
  });

  it('id inválido: 404 con mensaje de lugar', async () => {
    const { fetchMock, deps } = setup({});
    const response = await handleUpdatePlace(request('PATCH', { active: false }), 'x', deps);
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    const { error } = await response.json();
    expect(placeFailureMessage(error)).toBe(
      'No encontramos ese lugar. Puede que ya no exista; recarga la página.',
    );
    expect(catalogFailureMessage(error)).toMatch(/barrio o vereda/);
  });
});

describe('GET /api/admin/places/:id/history', () => {
  it('reenvía el cursor a /admin/places/:id/history', async () => {
    const { fetchMock, deps } = setup({
      [`GET /admin/places/${POZO_AZUL.id}/history`]: () =>
        jsonResponse({ items: [PLACE_CHANGE], nextCursor: null }),
    });
    const response = await handlePlaceHistory(request('GET'), POZO_AZUL.id, deps);
    expect(response.status).toBe(200);
    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('cursor')).toBe('c3');
  });
});

describe('cliente del navegador', () => {
  it('crear un lugar: POST /api/admin/places sin Authorization; lee el barrio calculado', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(HOSPITAL));
    const saved = await createPlace(
      { ...createBody, category: 'HEALTH' },
      { baseUrl: WEB_ORIGIN, fetch: fetchMock },
    );
    expect(saved?.area?.name).toBe('Centro');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${WEB_ORIGIN}${CatalogBffRoutes.PLACES}`);
    expect(init!.headers as Record<string, string>).not.toHaveProperty('authorization');
  });
});
