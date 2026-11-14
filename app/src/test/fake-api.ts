// Utilidades de prueba: API simulada con `fetch` falso y datos que cumplen el contrato.
import type { MeResponse, TokenPairResponse } from '@panter/contracts';
import type { FetchLike } from '../shared/api/http-client';

export const BASE_URL = 'https://api.test';

export function makeUser(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: '6f1c2a4e-8b0d-4c3e-9f7a-1b2c3d4e5f60',
    email: 'ana@example.com',
    fullName: null,
    phone: null,
    status: 'ACTIVE',
    roles: ['PASSENGER'],
    activeMode: 'passenger',
    ...overrides,
  };
}

export function makeTokenPair(
  n: number,
  overrides: Partial<TokenPairResponse> = {},
): TokenPairResponse {
  return {
    tokenType: 'Bearer',
    accessToken: `access-${n}`,
    expiresIn: 15 * 60,
    refreshToken: `refresh-${n}`,
    refreshExpiresIn: 30 * 24 * 60 * 60,
    user: makeUser(),
    ...overrides,
  };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function apiError(status: number, code: string, message = code): Response {
  return jsonResponse(status, { error: { code, message } });
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Route = (request: RecordedRequest) => Response | Promise<Response>;

/** `fetch` falso que registra cada petición y responde con `route`. */
export function fakeFetch(route: Route): FetchLike & { calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fn = async (input: string, init?: RequestInit) => {
    const request: RecordedRequest = {
      method: init?.method ?? 'GET',
      path: input.replace(BASE_URL, ''),
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(request);
    return route(request);
  };
  return Object.assign(fn, { calls });
}

/** Promesa que se resuelve desde fuera (para controlar el orden en pruebas de concurrencia). */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
