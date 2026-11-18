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
import { createDriversApi } from './drivers-api';
import {
  handleDocumentViewUrl,
  handleDriverAction,
  handleListDrivers,
  handleReviewDocument,
} from './drivers-routes';
import { DRIVER_ID, mockFetch, pendingDriver, type Handler } from './drivers-test-data';

let keys: TestKeys;
beforeAll(async () => {
  keys = await createTestKeys();
});

const ACCESS = 'at-de-la-cookie';
const REFRESH = 'rt-de-la-cookie';
const SESSION = { [ACCESS_COOKIE]: ACCESS, [REFRESH_COOKIE]: REFRESH };

function setup(routes: Record<string, Handler | Handler[]>) {
  const fetchMock = mockFetch(routes);
  const refresh = vi.fn<(token: string) => Promise<TokenPairResponse>>(() =>
    Promise.reject(new Error('refresh no esperado')),
  );
  return {
    fetchMock,
    refresh,
    deps: { drivers: createDriversApi({ apiUrl: API_URL, fetch: fetchMock }), refresh },
  };
}

function request(
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): NextRequest {
  const cookie = Object.entries(SESSION)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return new NextRequest(new URL(path, WEB_ORIGIN), {
    method,
    headers: {
      host: new URL(WEB_ORIGIN).host,
      origin: WEB_ORIGIN,
      'sec-fetch-site': 'same-origin',
      cookie,
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function authorization(fetchMock: ReturnType<typeof mockFetch>, call = 0) {
  return (fetchMock.mock.calls[call]![1]!.headers as Record<string, string>).authorization;
}

describe('GET /api/admin/drivers', () => {
  it('reenvía estado y cursor con Bearer y no devuelve tokens', async () => {
    const page = { items: [pendingDriver()], nextCursor: 'c3' };
    const { fetchMock, deps } = setup({ 'GET /admin/drivers': () => jsonResponse(page) });
    const response = await handleListDrivers(
      request('GET', '/api/admin/drivers?status=PENDING&cursor=c2'),
      deps,
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual(page);
    expect(text).not.toContain(ACCESS);
    expect(authorization(fetchMock)).toBe(`Bearer ${ACCESS}`);
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.searchParams.get('status')).toBe('PENDING');
    expect(url.searchParams.get('cursor')).toBe('c2');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rechaza un estado desconocido sin llamar a la API', async () => {
    const { fetchMock, deps } = setup({});
    const response = await handleListDrivers(request('GET', '/api/admin/drivers?status=X'), deps);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con TOKEN_EXPIRED refresca, repite y guarda las cookies nuevas', async () => {
    const fresh = await tokenPair(keys, [Role.ADMIN], 'rt-rotado');
    const { fetchMock, refresh, deps } = setup({
      'GET /admin/drivers': [
        () => apiError(401, ApiErrorCode.TOKEN_EXPIRED),
        () => jsonResponse({ items: [], nextCursor: null }),
      ],
    });
    refresh.mockResolvedValue(fresh);
    const response = await handleListDrivers(request('GET', '/api/admin/drivers'), deps);
    expect(response.status).toBe(200);
    expect(authorization(fetchMock, 1)).toBe(`Bearer ${fresh.accessToken}`);
    expect(setCookie(response, REFRESH_COOKIE)?.value).toBe('rt-rotado');
  });

  it('rechaza peticiones de otro sitio', async () => {
    const { fetchMock, deps } = setup({});
    const response = await handleListDrivers(
      request('GET', '/api/admin/drivers', { headers: { 'sec-fetch-site': 'cross-site' } }),
      deps,
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('documentos', () => {
  it('pide una URL firmada nueva de lectura', async () => {
    const view = {
      url: 'https://api.panter.test/files/x?sig=abc',
      expiresAt: '2026-11-18T15:10:00Z',
    };
    const { fetchMock, deps } = setup({
      [`GET /admin/drivers/${DRIVER_ID}/documents/SOAT/view-url`]: () => jsonResponse(view),
    });
    const response = await handleDocumentViewUrl(
      request('GET', `/api/admin/drivers/${DRIVER_ID}/documents/SOAT/view-url`),
      DRIVER_ID,
      'SOAT',
      deps,
    );
    expect(await response.json()).toEqual(view);
    expect(authorization(fetchMock)).toBe(`Bearer ${ACCESS}`);
  });

  it('tipo de documento o id inválido → 404 sin llamar a la API', async () => {
    const { fetchMock, deps } = setup({});
    const bad = await handleDocumentViewUrl(request('GET', '/x'), DRIVER_ID, 'PASAPORTE', deps);
    expect(bad.status).toBe(404);
    const badId = await handleDocumentViewUrl(request('GET', '/x'), 'no-uuid', 'SOAT', deps);
    expect(badId.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechazar un documento exige motivo de al menos 5 caracteres', async () => {
    const { fetchMock, deps } = setup({});
    for (const body of [{ decision: 'REJECTED' }, { decision: 'REJECTED', reason: ' mal ' }]) {
      const response = await handleReviewDocument(
        request('POST', '/x', { body }),
        DRIVER_ID,
        'SOAT',
        deps,
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reenvía la revisión a la API', async () => {
    const { fetchMock, deps } = setup({
      [`POST /admin/drivers/${DRIVER_ID}/documents/LICENCIA/review`]: () =>
        jsonResponse({ ok: true }),
    });
    const response = await handleReviewDocument(
      request('POST', '/x', { body: { decision: 'REJECTED', reason: 'La licencia está vencida' } }),
      DRIVER_ID,
      'LICENCIA',
      deps,
    );
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0]![1]!.body).toBe(
      '{"decision":"REJECTED","reason":"La licencia está vencida"}',
    );
  });
});

describe('POST /api/admin/drivers/:userId/:action', () => {
  it('aprobar y reactivar no llevan motivo', async () => {
    const { fetchMock, deps } = setup({
      [`POST /admin/drivers/${DRIVER_ID}/approve`]: () => jsonResponse(pendingDriver()),
      [`POST /admin/drivers/${DRIVER_ID}/reinstate`]: () => new Response(null, { status: 204 }),
    });
    expect(
      (await handleDriverAction(request('POST', '/x'), DRIVER_ID, 'approve', deps)).status,
    ).toBe(200);
    expect(
      (await handleDriverAction(request('POST', '/x'), DRIVER_ID, 'reinstate', deps)).status,
    ).toBe(200);
    expect(fetchMock.mock.calls[0]![1]!.body).toBe('{}');
  });

  it('rechazar y suspender exigen motivo válido', async () => {
    const { fetchMock, deps } = setup({
      [`POST /admin/drivers/${DRIVER_ID}/suspend`]: () => jsonResponse({}),
    });
    const short = await handleDriverAction(
      request('POST', '/x', { body: { reason: 'no' } }),
      DRIVER_ID,
      'reject',
      deps,
    );
    expect(short.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    const ok = await handleDriverAction(
      request('POST', '/x', { body: { reason: '  Quejas de pasajeros  ' } }),
      DRIVER_ID,
      'suspend',
      deps,
    );
    expect(ok.status).toBe(200);
    expect(fetchMock.mock.calls[0]![1]!.body).toBe('{"reason":"Quejas de pasajeros"}');
  });

  it('una acción desconocida responde 404', async () => {
    const { fetchMock, deps } = setup({});
    const response = await handleDriverAction(request('POST', '/x'), DRIVER_ID, 'borrar', deps);
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pasa DOCUMENTS_INCOMPLETE e INVALID_DRIVER_TRANSITION tal cual', async () => {
    const { deps } = setup({
      [`POST /admin/drivers/${DRIVER_ID}/approve`]: () =>
        apiError(409, ApiErrorCode.DOCUMENTS_INCOMPLETE),
      [`POST /admin/drivers/${DRIVER_ID}/reinstate`]: () =>
        apiError(409, ApiErrorCode.INVALID_DRIVER_TRANSITION),
    });
    const approve = await handleDriverAction(request('POST', '/x'), DRIVER_ID, 'approve', deps);
    expect(approve.status).toBe(409);
    expect((await approve.json()).error.code).toBe(ApiErrorCode.DOCUMENTS_INCOMPLETE);
    const reinstate = await handleDriverAction(request('POST', '/x'), DRIVER_ID, 'reinstate', deps);
    expect((await reinstate.json()).error.code).toBe(ApiErrorCode.INVALID_DRIVER_TRANSITION);
  });
});
