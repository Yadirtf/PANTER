import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, ClientErrorCode, toErrorBody } from './errors';
import { buildUrl, createHttpClient } from './http-client';

const BASE = 'https://panter-api-staging.example.workers.dev';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function clientWith(response: Response | (() => Promise<Response>)) {
  const fetchMock = vi.fn<typeof fetch>(
    typeof response === 'function' ? response : () => Promise.resolve(response),
  );
  return { fetchMock, client: createHttpClient({ baseUrl: BASE, fetch: fetchMock }) };
}

async function catchError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('Se esperaba un error');
}

const ItemSchema = z.object({ id: z.string(), total: z.number() });

describe('buildUrl', () => {
  it('une base y ruta sin duplicar barras y agrega query omitiendo vacíos', () => {
    expect(buildUrl(`${BASE}/`, '/health')).toBe(`${BASE}/health`);
    expect(buildUrl(`${BASE}/v1`, 'trips', { page: 2, q: 'río', skip: undefined, n: null })).toBe(
      `${BASE}/v1/trips?page=2&q=r%C3%ADo`,
    );
  });
});

describe('createHttpClient', () => {
  it('devuelve los datos validados por el esquema', async () => {
    const { client, fetchMock } = clientWith(jsonResponse({ id: 'a1', total: 3, extra: true }));

    const data = await client.get('/items/a1', { schema: ItemSchema });

    expect(data).toEqual({ id: 'a1', total: 3 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/items/a1`);
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
  });

  it('serializa el cuerpo como JSON y envía el token como Bearer', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ id: 'b2', total: 1 }, { status: 201 })),
    );
    const client = createHttpClient({
      baseUrl: BASE,
      fetch: fetchMock,
      getAccessToken: () => 'tok123',
    });

    await client.post('/items', { schema: ItemSchema, body: { total: 1 } });

    const init = fetchMock.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"total":1}');
    expect(headers['content-type']).toBe('application/json');
    expect(headers.authorization).toBe('Bearer tok123');
  });

  it('acepta 204 sin cuerpo si el esquema lo permite', async () => {
    const { client } = clientWith(new Response(null, { status: 204 }));
    await expect(client.delete('/items/a1', { schema: z.undefined() })).resolves.toBeUndefined();
  });

  it('normaliza errores de la API con formato { error: { code, message } }', async () => {
    const { client } = clientWith(
      jsonResponse(
        { error: { code: 'TRIP_NOT_FOUND', message: 'Viaje no encontrado' } },
        { status: 404 },
      ),
    );

    const error = await catchError(client.get('/trips/x', { schema: ItemSchema }));

    expect(error.code).toBe('TRIP_NOT_FOUND');
    expect(error.message).toBe('Viaje no encontrado');
    expect(error.status).toBe(404);
    expect(error.toJSON()).toEqual({
      error: { code: 'TRIP_NOT_FOUND', message: 'Viaje no encontrado' },
    });
  });

  it('usa HTTP_ERROR cuando el error no tiene el formato esperado', async () => {
    const { client } = clientWith(
      new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' }),
    );

    const error = await catchError(client.get('/health', { schema: ItemSchema }));

    expect(error.code).toBe(ClientErrorCode.HTTP_ERROR);
    expect(error.status).toBe(502);
  });

  it('lanza INVALID_RESPONSE si la respuesta no cumple el contrato', async () => {
    const { client } = clientWith(jsonResponse({ id: 1 }));

    const error = await catchError(client.get('/items/a1', { schema: ItemSchema }));

    expect(error.code).toBe(ClientErrorCode.INVALID_RESPONSE);
    expect(error.status).toBe(200);
    expect(Array.isArray(error.details)).toBe(true);
  });

  it('lanza INVALID_RESPONSE si el JSON está mal formado', async () => {
    const { client } = clientWith(
      new Response('{nope', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const error = await catchError(client.get('/items/a1', { schema: ItemSchema }));

    expect(error.code).toBe(ClientErrorCode.INVALID_RESPONSE);
  });

  it('lanza NETWORK_ERROR si fetch falla', async () => {
    const { client } = clientWith(() => Promise.reject(new TypeError('fetch failed')));

    const error = await catchError(client.get('/health', { schema: ItemSchema }));

    expect(error.code).toBe(ClientErrorCode.NETWORK_ERROR);
    expect(error.status).toBe(0);
  });

  it('lanza ABORTED si la petición se cancela', async () => {
    const { client } = clientWith(() =>
      Promise.reject(new DOMException('The operation was aborted.', 'AbortError')),
    );

    const error = await catchError(client.get('/health', { schema: ItemSchema }));

    expect(error.code).toBe(ClientErrorCode.ABORTED);
  });
});

describe('toErrorBody', () => {
  it('normaliza cualquier valor al formato de error de la API', () => {
    expect(toErrorBody(new Error('boom'))).toEqual({
      error: { code: ClientErrorCode.UNKNOWN, message: 'boom' },
    });
    expect(toErrorBody('x')).toEqual({
      error: { code: ClientErrorCode.UNKNOWN, message: 'Error desconocido.' },
    });
  });
});
