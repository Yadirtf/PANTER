import { AuthRoutes, MeResponseSchema, OtpRequestResponseSchema } from '@panter/contracts';
import { describe, expect, it, vi } from 'vitest';
import { apiError, BASE_URL, fakeFetch, jsonResponse, makeUser } from '../../test/fake-api';
import { ApiError } from './errors';
import { type AuthHandler, createHttpClient } from './http-client';

const sent = { status: 'sent', expiresInSeconds: 300, resendAfterSeconds: 60 };

async function catchError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('Se esperaba un error');
}

describe('createHttpClient', () => {
  it('envía JSON a la URL base y valida la respuesta con el contrato', async () => {
    const fetch = fakeFetch(() => jsonResponse(202, sent));
    const http = createHttpClient({ baseUrl: `${BASE_URL}/`, fetch });

    const result = await http.request({
      path: AuthRoutes.OTP_REQUEST,
      body: { email: 'ana@example.com' },
      schema: OtpRequestResponseSchema,
    });

    expect(result).toEqual(sent);
    expect(fetch.calls).toEqual([
      {
        method: 'POST',
        path: '/auth/otp/request',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: { email: 'ana@example.com' },
      },
    ]);
  });

  it('usa GET sin cuerpo cuando no hay body', async () => {
    const fetch = fakeFetch(() => jsonResponse(200, sent));
    const http = createHttpClient({ baseUrl: BASE_URL, fetch });
    await http.request({ path: '/x', schema: OtpRequestResponseSchema });
    expect(fetch.calls[0]?.method).toBe('GET');
    expect(fetch.calls[0]?.body).toBeUndefined();
  });

  it('normaliza el cuerpo de error de la API a { code, message }', async () => {
    const http = createHttpClient({
      baseUrl: BASE_URL,
      fetch: fakeFetch(() => apiError(400, 'OTP_INVALID', 'Código incorrecto')),
    });
    const error = await catchError(
      http.request({ path: AuthRoutes.OTP_VERIFY, body: {}, schema: OtpRequestResponseSchema }),
    );
    expect(error.toJSON()).toEqual({ code: 'OTP_INVALID', message: 'Código incorrecto' });
    expect(error.status).toBe(400);
  });

  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [429, 'BAD_REQUEST'],
    [502, 'INTERNAL_ERROR'],
  ])('sin cuerpo de error reconocible, %i se mapea a %s', async (status, code) => {
    const http = createHttpClient({
      baseUrl: BASE_URL,
      fetch: fakeFetch(() => new Response('<html>Bad gateway</html>', { status })),
    });
    const error = await catchError(http.send({ path: '/x' }));
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
  });

  it('sin red lanza NETWORK_ERROR', async () => {
    const http = createHttpClient({
      baseUrl: BASE_URL,
      fetch: async () => {
        throw new TypeError('Network request failed');
      },
    });
    const error = await catchError(http.send({ path: '/x' }));
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.status).toBe(0);
  });

  it('si la API no responde a tiempo lanza NETWORK_ERROR', async () => {
    const http = createHttpClient({
      baseUrl: BASE_URL,
      timeoutMs: 5,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    });
    const error = await catchError(http.send({ path: '/x' }));
    expect(error.code).toBe('NETWORK_ERROR');
  });

  it('una respuesta que no cumple el contrato lanza INVALID_RESPONSE', async () => {
    for (const response of [
      jsonResponse(200, { status: 'otro' }),
      new Response('no es json', { status: 200 }),
      new Response(null, { status: 204 }),
    ]) {
      const http = createHttpClient({ baseUrl: BASE_URL, fetch: async () => response });
      const error = await catchError(
        http.request({ path: '/x', schema: OtpRequestResponseSchema }),
      );
      expect(error.code).toBe('INVALID_RESPONSE');
    }
  });

  it('send ignora el cuerpo de una respuesta exitosa', async () => {
    const http = createHttpClient({
      baseUrl: BASE_URL,
      fetch: async () => new Response(null, { status: 204 }),
    });
    await expect(http.send({ path: AuthRoutes.LOGOUT, body: {} })).resolves.toBeUndefined();
  });

  describe('peticiones autenticadas', () => {
    function handler(tokens: string[]): AuthHandler & { refreshed: string[] } {
      const refreshed: string[] = [];
      return {
        refreshed,
        getAccessToken: vi.fn(async () => tokens[0] ?? 'none'),
        refreshAccessToken: vi.fn(async (stale: string) => {
          refreshed.push(stale);
          return tokens[refreshed.length] ?? 'none';
        }),
      };
    }

    it('sin store de sesión falla con UNAUTHENTICATED sin llamar a la API', async () => {
      const fetch = fakeFetch(() => jsonResponse(200, makeUser()));
      const http = createHttpClient({ baseUrl: BASE_URL, fetch });
      const error = await catchError(
        http.request({ path: AuthRoutes.ME, auth: true, schema: MeResponseSchema }),
      );
      expect(error.code).toBe('UNAUTHENTICATED');
      expect(fetch.calls).toHaveLength(0);
    });

    it('envía el access token como Bearer', async () => {
      const fetch = fakeFetch(() => jsonResponse(200, makeUser()));
      const http = createHttpClient({ baseUrl: BASE_URL, fetch });
      http.setAuthHandler(handler(['t1']));
      await http.request({ path: AuthRoutes.ME, auth: true, schema: MeResponseSchema });
      expect(fetch.calls[0]?.headers.Authorization).toBe('Bearer t1');
    });

    it('ante 401 TOKEN_EXPIRED refresca y reintenta una sola vez', async () => {
      const fetch = fakeFetch((req) =>
        req.headers.Authorization === 'Bearer t2'
          ? jsonResponse(200, makeUser())
          : apiError(401, 'TOKEN_EXPIRED'),
      );
      const http = createHttpClient({ baseUrl: BASE_URL, fetch });
      const auth = handler(['t1', 't2']);
      http.setAuthHandler(auth);

      const me = await http.request({ path: AuthRoutes.ME, auth: true, schema: MeResponseSchema });

      expect(me.email).toBe('ana@example.com');
      expect(auth.refreshed).toEqual(['t1']);
      expect(fetch.calls.map((c) => c.headers.Authorization)).toEqual(['Bearer t1', 'Bearer t2']);
    });

    it('si el reintento vuelve a fallar no entra en bucle', async () => {
      const fetch = fakeFetch(() => apiError(401, 'TOKEN_EXPIRED'));
      const http = createHttpClient({ baseUrl: BASE_URL, fetch });
      const auth = handler(['t1', 't2', 't3']);
      http.setAuthHandler(auth);

      const error = await catchError(http.send({ path: AuthRoutes.ME, auth: true }));
      expect(error.code).toBe('TOKEN_EXPIRED');
      expect(fetch.calls).toHaveLength(2);
      expect(auth.refreshed).toEqual(['t1']);
    });

    it('otros errores 401 o 403 no disparan el refresh', async () => {
      const fetch = fakeFetch(() => apiError(403, 'FORBIDDEN'));
      const http = createHttpClient({ baseUrl: BASE_URL, fetch });
      const auth = handler(['t1']);
      http.setAuthHandler(auth);
      const error = await catchError(http.send({ path: AuthRoutes.ME, auth: true }));
      expect(error.code).toBe('FORBIDDEN');
      expect(auth.refreshed).toEqual([]);
    });
  });
});
