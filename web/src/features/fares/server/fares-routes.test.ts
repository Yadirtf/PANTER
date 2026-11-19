import { ApiErrorCode, Role, type TokenPairResponse } from '@panter/contracts';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/features/auth/server/cookies';
import {
  API_URL,
  apiError,
  createTestKeys,
  jsonResponse,
  setCookie,
  tokenPair,
  WEB_ORIGIN,
  type TestKeys,
} from '@/features/auth/server/test-helpers';
import { mockFetch, type Handler } from '@/features/drivers/server/drivers-test-data';
import { ruleBody } from '../lib/fares';
import { createFaresApi } from './fares-api';
import { handleFareHistory, handleUpdateGeofence, handleUpdateRule } from './fares-routes';
import { AIRPORT_ID, RULE_CHANGE, TAXI_RULE } from './fares-test-data';

let keys: TestKeys;
beforeAll(async () => {
  keys = await createTestKeys();
});

const ACCESS = 'at-de-la-cookie';
const REFRESH = 'rt-de-la-cookie';

function setup(routes: Record<string, Handler | Handler[]>) {
  const fetchMock = mockFetch(routes);
  const refresh = vi.fn<(token: string) => Promise<TokenPairResponse>>(() =>
    Promise.reject(new Error('refresh no esperado')),
  );
  return {
    fetchMock,
    refresh,
    deps: { fares: createFaresApi({ apiUrl: API_URL, fetch: fetchMock }), refresh },
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

const authorization = (fetchMock: ReturnType<typeof mockFetch>, call = 0) =>
  (fetchMock.mock.calls[call]![1]!.headers as Record<string, string>).authorization;

describe('PUT /api/admin/fares/rules/:vehicleType', () => {
  const body = { ...ruleBody(TAXI_RULE), baseFare: 6500 };

  it('valida con FareRuleUpdateBodySchema y reenvía con Bearer', async () => {
    const { fetchMock, deps } = setup({
      'PUT /admin/fares/rules/TAXI': () => jsonResponse({ ...TAXI_RULE, baseFare: 6500 }),
    });
    const response = await handleUpdateRule(request('PUT', '/x', { body }), 'TAXI', deps);
    expect(response.status).toBe(200);
    expect(authorization(fetchMock)).toBe(`Bearer ${ACCESS}`);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual(body);
    const text = await response.text();
    expect(text).not.toContain(ACCESS);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rechaza valores fuera del contrato sin llamar a la API', async () => {
    const { fetchMock, deps } = setup({});
    for (const bad of [
      { ...body, baseFare: -1 },
      { ...body, baseFare: 2_000_000 },
      { ...body, nightStartMinute: 1440 },
      { ...body, roundTo: 0 },
      { ...body, pricingModel: 'GRATIS' },
      { ...body, perKm: 12.5 },
    ]) {
      const response = await handleUpdateRule(request('PUT', '/x', { body: bad }), 'TAXI', deps);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
    }
    const unknownType = await handleUpdateRule(request('PUT', '/x', { body }), 'BUS', deps);
    expect(unknownType.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con TOKEN_EXPIRED refresca y guarda las cookies nuevas', async () => {
    const fresh = await tokenPair(keys, [Role.ADMIN], 'rt-rotado');
    const { fetchMock, refresh, deps } = setup({
      'PUT /admin/fares/rules/TAXI': [
        () => apiError(401, ApiErrorCode.TOKEN_EXPIRED),
        () => new Response(null, { status: 204 }),
      ],
    });
    refresh.mockResolvedValue(fresh);
    const response = await handleUpdateRule(request('PUT', '/x', { body }), 'TAXI', deps);
    expect(response.status).toBe(200);
    expect(authorization(fetchMock, 1)).toBe(`Bearer ${fresh.accessToken}`);
    expect(setCookie(response, REFRESH_COOKIE)?.value).toBe('rt-rotado');
  });

  it('pasa FORBIDDEN y FARE_RULE_NOT_FOUND de la API', async () => {
    const { deps } = setup({
      'PUT /admin/fares/rules/TAXI': () => apiError(403, ApiErrorCode.FORBIDDEN),
      'PUT /admin/fares/rules/JEEP_4X4': () => apiError(404, ApiErrorCode.FARE_RULE_NOT_FOUND),
    });
    const forbidden = await handleUpdateRule(request('PUT', '/x', { body }), 'TAXI', deps);
    expect(forbidden.status).toBe(403);
    const missing = await handleUpdateRule(request('PUT', '/x', { body }), 'JEEP_4X4', deps);
    expect((await missing.json()).error.code).toBe(ApiErrorCode.FARE_RULE_NOT_FOUND);
  });

  it('rechaza peticiones de otro sitio', async () => {
    const { fetchMock, deps } = setup({});
    const response = await handleUpdateRule(
      request('PUT', '/x', { body, headers: { 'sec-fetch-site': 'cross-site' } }),
      'TAXI',
      deps,
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/admin/fares/geofences/:id', () => {
  it('envía solo nombre, recargo, appliesTo y active (el polígono no se edita aquí)', async () => {
    const { fetchMock, deps } = setup({
      [`PUT /admin/fares/geofences/${AIRPORT_ID}`]: () => jsonResponse({}),
    });
    const response = await handleUpdateGeofence(
      request('PUT', '/x', {
        body: {
          name: '  Aeropuerto VGZ ',
          surcharge: 6000,
          appliesTo: ['TAXI'],
          active: true,
          polygon: [[{ lat: 0, lng: 0 }]],
        },
      }),
      AIRPORT_ID,
      deps,
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      name: 'Aeropuerto VGZ',
      surcharge: 6000,
      appliesTo: ['TAXI'],
      active: true,
    });
  });

  it('valida el cuerpo y el id', async () => {
    const { fetchMock, deps } = setup({});
    const empty = await handleUpdateGeofence(
      request('PUT', '/x', { body: { name: 'X', surcharge: 1, appliesTo: [], active: true } }),
      AIRPORT_ID,
      deps,
    );
    expect(empty.status).toBe(400);
    const badId = await handleUpdateGeofence(
      request('PUT', '/x', {
        body: { name: 'X', surcharge: 1, appliesTo: ['TAXI'], active: true },
      }),
      'no-uuid',
      deps,
    );
    expect(badId.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/fares/history', () => {
  it('pide la página siguiente con el cursor', async () => {
    const page = { items: [RULE_CHANGE], nextCursor: null };
    const { fetchMock, deps } = setup({ 'GET /admin/fares/history': () => jsonResponse(page) });
    const response = await handleFareHistory(
      request('GET', '/api/admin/fares/history?cursor=c2'),
      deps,
    );
    expect(await response.json()).toEqual(page);
    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('cursor')).toBe('c2');
  });
});
