// HU-305: GET /routes dentro de workerd, con KV de Miniflare y fetch simulado de ORS (fixture
// con el formato de respuesta de POST /v2/directions/driving-car).
import { ApiErrorCode, MapRoutes, PLACES, Role, RouteResponseSchema } from '@panter/contracts';
import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildAuthFactories } from '../src/composition/auth';
import { buildRoutingFactories, type RoutingOverrides } from '../src/composition/routing';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import type { RouteProviderError } from '../src/modules/routing/application/ports';
import { createJoseAccessTokenSigner } from '../src/modules/auth/infrastructure/jose-access-tokens';
import {
  createConsoleRoutingLog,
  createKvRouteRateStore,
  createKvUsageCounter,
  ORS_USAGE_PREFIX,
} from '../src/modules/routing/infrastructure/kv-routing-stores';
import {
  createOrsRouteProvider,
  parseRetryAfter,
  type FetchLike,
} from '../src/modules/routing/infrastructure/openrouteservice-route-provider';
import orsFixture from './fixtures/ors-directions-centro-vgz.json';
import { MemoryUserRepository } from './support/auth-fakes';
import { RecordingRoutingLog } from './support/routing-fakes';
import { testKeys, type TestKeys } from './support/jwt-keys';

let keys: TestKeys;
beforeAll(async () => {
  keys = await testKeys();
});

interface ErrorJson {
  error: { code: string; message: string; details?: unknown };
}

interface Captured {
  url: string;
  init: RequestInit;
}

/** fetch simulado de ORS: responde el fixture y guarda lo que se envió. */
function fakeOrs(respond: () => Response | Promise<Response> = () => Response.json(orsFixture)) {
  const calls: Captured[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return respond();
  };
  return { calls, fetch };
}

// Coordenadas distintas por prueba: la caché KV se comparte dentro del archivo.
let seq = 0;
const uniqueOrigin = () => ({ lat: 1.0295 + ++seq / 1000, lng: -76.6165 });

function setup(overrides: RoutingOverrides = {}, envOverrides: Partial<Env> = {}) {
  const log = new RecordingRoutingLog();
  const app = createApp({
    auth: buildAuthFactories({ users: () => new MemoryUserRepository() }),
    routing: buildRoutingFactories({ log, ...overrides }),
  });
  const userId = crypto.randomUUID();
  const testEnv: Env = {
    ...env,
    JWT_PUBLIC_KEY: keys.publicKeyPem,
    ORS_API_KEY: 'ors-test-key',
    ...envOverrides,
  };
  async function get(query: string, auth = true) {
    const headers: Record<string, string> = {};
    if (auth) {
      const signer = createJoseAccessTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: 'k' });
      const { token } = await signer.sign({
        userId,
        roles: [Role.PASSENGER],
        activeMode: 'passenger',
      });
      headers.authorization = `Bearer ${token}`;
    }
    return app.request(`${MapRoutes.ROUTE}?${query}`, { headers }, testEnv);
  }
  const q = (o: { lat: number; lng: number }, d: { lat: number; lng: number }) =>
    `origin=${o.lat},${o.lng}&destination=${d.lat},${d.lng}`;
  return { get, q, log };
}

describe('GET /routes', () => {
  it('llama a ORS con la clave solo en el Worker y luego responde desde la caché KV', async () => {
    const ors = fakeOrs();
    const { get, q, log } = setup({ fetch: ors.fetch });
    const origin = uniqueOrigin();
    const res = await get(q(origin, PLACES.AIRPORT_VGZ));
    expect(res.status).toBe(200);
    const body = RouteResponseSchema.parse(await res.json());
    expect(body).toEqual({
      distanceMeters: 5876.4,
      durationSeconds: 548.9,
      polyline: orsFixture.routes[0]!.geometry,
      bbox: [-76.61716, 0.97893, -76.60531, 1.02951],
      cached: false,
    });

    expect(ors.calls).toHaveLength(1);
    const call = ors.calls[0]!;
    expect(call.url).toBe('https://api.openrouteservice.org/v2/directions/driving-car');
    expect(call.init.method).toBe('POST');
    expect((call.init.headers as Record<string, string>).authorization).toBe('ors-test-key');
    expect(JSON.parse(call.init.body as string)).toEqual({
      coordinates: [
        [origin.lng, origin.lat],
        [PLACES.AIRPORT_VGZ.lng, PLACES.AIRPORT_VGZ.lat],
      ],
      instructions: false,
      units: 'm',
    });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);

    // Mismo par a menos de 11 m: caché, sin otra consulta a ORS.
    const again = await get(q({ ...origin, lng: origin.lng + 0.00001 }, PLACES.AIRPORT_VGZ));
    expect(RouteResponseSchema.parse(await again.json()).cached).toBe(true);
    expect(ors.calls).toHaveLength(1);
    expect(log.requests).toHaveLength(1);
    expect(log.requests[0]).toMatchObject({ outcome: 'ok', quota: 2000 });
  });

  it('cuenta las consultas reales del día en KV (clave por fecha de Colombia)', async () => {
    const ors = fakeOrs();
    const now = Date.parse('2026-03-02T04:30:00Z'); // 11:30 p. m. del 1.º de marzo en Colombia
    const { get, q, log } = setup({ fetch: ors.fetch, clock: () => now });
    await get(q(uniqueOrigin(), PLACES.AIRPORT_VGZ));
    await get(q(uniqueOrigin(), PLACES.AIRPORT_VGZ));
    expect(await env.KV.get(`${ORS_USAGE_PREFIX}2026-03-01`)).toBe('2');
    expect(log.requests.map((r) => [r.date, r.count])).toEqual([
      ['2026-03-01', 1],
      ['2026-03-01', 2],
    ]);
  });

  it('formato inválido → 400; sin token → 401; fuera del área → 422', async () => {
    const { get, q } = setup({ fetch: fakeOrs().fetch });
    expect((await get('origin=abc&destination=1,2')).status).toBe(400);
    expect((await get(`${q(uniqueOrigin(), PLACES.AIRPORT_VGZ)}&profile=foot`)).status).toBe(400);
    expect((await get(q(uniqueOrigin(), PLACES.AIRPORT_VGZ), false)).status).toBe(401);
    const res = await get(q({ lat: 4.711, lng: -74.0721 }, PLACES.AIRPORT_VGZ));
    expect(res.status).toBe(422);
    expect((await res.json<ErrorJson>()).error).toMatchObject({
      code: ApiErrorCode.OUT_OF_SERVICE_AREA,
      details: { point: 'origin' },
    });
  });

  it('ORS sin ruta (2010: sin vía cercana) → 422 ROUTE_NOT_FOUND', async () => {
    const ors = fakeOrs(() =>
      Response.json(
        {
          error: {
            code: 2010,
            message:
              'Could not find routable point within a radius of 350.0 meters of specified coordinate 1: -76.6000000 1.2000000.',
          },
          info: { engine: { version: '9.3.0' }, timestamp: 1795461600000 },
        },
        { status: 404 },
      ),
    );
    const { get, q } = setup({ fetch: ors.fetch });
    const res = await get(q(uniqueOrigin(), { lat: 1.2, lng: -76.6 }));
    expect(res.status).toBe(422);
    expect((await res.json<ErrorJson>()).error.code).toBe(ApiErrorCode.ROUTE_NOT_FOUND);
  });

  it('cuota de ORS agotada (429) → 503 ROUTING_UNAVAILABLE con Retry-After', async () => {
    const ors = fakeOrs(
      () =>
        new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429,
          headers: { 'retry-after': '120' },
        }),
    );
    const { get, q } = setup({ fetch: ors.fetch });
    const res = await get(q(uniqueOrigin(), PLACES.AIRPORT_VGZ));
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('120');
    expect((await res.json<ErrorJson>()).error.code).toBe(ApiErrorCode.ROUTING_UNAVAILABLE);
  });

  it('sin ORS_API_KEY → 503 claro y /health sigue funcionando', async () => {
    const ors = fakeOrs();
    const { get, q, log } = setup({ fetch: ors.fetch }, { ORS_API_KEY: undefined });
    const res = await get(q(uniqueOrigin(), PLACES.AIRPORT_VGZ));
    expect(res.status).toBe(503);
    const body = await res.json<ErrorJson>();
    expect(body.error.code).toBe(ApiErrorCode.ROUTING_UNAVAILABLE);
    expect(body.error.message).toMatch(/Intenta de nuevo/);
    expect(log.notConfiguredMessages[0]).toMatch(/ORS_API_KEY/);
    expect(ors.calls).toHaveLength(0);
    expect((await exports.default.fetch('https://api.test/health')).status).toBe(200);
  });

  it('el límite por usuario responde 429 con Retry-After', async () => {
    const ors = fakeOrs();
    const { get, q } = setup({ fetch: ors.fetch });
    let last: Response | undefined;
    for (let i = 0; i < 21; i++) last = await get(q(uniqueOrigin(), PLACES.AIRPORT_VGZ));
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get('Retry-After'))).toBeGreaterThan(3000);
    expect(ors.calls).toHaveLength(20);
  });
});

describe('adaptador OpenRouteService', () => {
  const req = {
    origin: PLACES.VILLAGARZON_CENTER,
    destination: PLACES.AIRPORT_VGZ,
    profile: 'driving-car' as const,
  };

  async function reasonOf(fetch: FetchLike, apiKey: string | undefined = 'k') {
    try {
      await createOrsRouteProvider({ apiKey, fetch, now: () => 0 }).route(req);
    } catch (error) {
      const e = error as RouteProviderError;
      return { reason: e.reason, status: e.status, retryAfterSeconds: e.retryAfterSeconds };
    }
    throw new Error('se esperaba un error');
  }

  it('traduce los fallos de ORS', async () => {
    expect(await reasonOf(fakeOrs().fetch, '  ')).toMatchObject({ reason: 'not_configured' });
    expect(
      await reasonOf(() => Promise.reject(new DOMException('timeout', 'TimeoutError'))),
    ).toMatchObject({ reason: 'unavailable' });
    expect(await reasonOf(async () => new Response('Bad gateway', { status: 502 }))).toEqual({
      reason: 'unavailable',
      status: 502,
      retryAfterSeconds: undefined,
    });
    expect(
      await reasonOf(async () =>
        Response.json(
          { error: { code: 2009, message: 'Route could not be found' } },
          { status: 404 },
        ),
      ),
    ).toMatchObject({ reason: 'not_found', status: 404 });
    expect(
      await reasonOf(async () =>
        Response.json({ error: { code: 2003, message: 'Parameter is invalid' } }, { status: 400 }),
      ),
    ).toMatchObject({ reason: 'unavailable', status: 400 });
    expect(
      await reasonOf(
        async () =>
          new Response('{"error":"Access to this API has been disallowed"}', { status: 403 }),
      ),
    ).toMatchObject({ reason: 'unavailable', status: 403 });
    const broken = new ReadableStream({
      start: (controller) => controller.error(new Error('conexión cortada')),
    });
    expect(await reasonOf(async () => new Response(broken, { status: 502 }))).toMatchObject({
      reason: 'unavailable',
      status: 502,
    });
    expect(await reasonOf(async () => new Response('<html>', { status: 200 }))).toMatchObject({
      reason: 'unavailable',
    });
    expect(await reasonOf(async () => Response.json({ routes: [] }))).toMatchObject({
      reason: 'not_found',
    });
  });

  it('origen = destino: ORS omite distance y duration; bbox se calcula de la polilínea', async () => {
    const provider = createOrsRouteProvider({
      apiKey: 'k',
      baseUrl: 'https://ors.test/',
      fetch: async (url) => {
        expect(url).toBe('https://ors.test/v2/directions/driving-car');
        return Response.json({ routes: [{ summary: {}, geometry: '_ibE_ibE' }] });
      },
    });
    expect(await provider.route(req)).toEqual({
      distanceMeters: 0,
      durationSeconds: 0,
      polyline: '_ibE_ibE',
      bbox: [1, 1, 1, 1],
    });
  });

  it('Retry-After en segundos o como fecha HTTP', () => {
    const now = Date.parse('2026-11-18T12:00:00Z');
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('30', now)).toBe(30);
    expect(parseRetryAfter('0', now)).toBe(1);
    expect(parseRetryAfter('Wed, 18 Nov 2026 12:01:00 GMT', now)).toBe(60);
    expect(parseRetryAfter('pronto', now)).toBeUndefined();
  });
});

describe('almacenes KV y logs', () => {
  it('contador diario con TTL y ventana del límite por usuario', async () => {
    const counter = createKvUsageCounter(env.KV);
    expect(await counter.increment('2026-01-05')).toBe(1);
    await env.KV.put(`${ORS_USAGE_PREFIX}2026-01-06`, 'basura');
    expect(await counter.increment('2026-01-06')).toBe(1);

    // KV compara la expiración con la hora real: una ventana que cierra en 10 s se guarda 60 s.
    const now = Date.now();
    const rate = createKvRouteRateStore(env.KV);
    expect(await rate.get('nadie')).toBeNull();
    await rate.put('u', { count: 3, resetAt: now + 10_000 });
    expect(await rate.get('u')).toEqual({ count: 3, resetAt: now + 10_000 });
  });

  it('logs estructurados', () => {
    const log = createConsoleRoutingLog();
    const out: unknown[] = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = (entry: unknown) => out.push(entry);
    try {
      log.providerRequest({
        date: '2026-11-18',
        count: 5,
        quota: 2000,
        outcome: 'ok',
        durationMs: 120,
      });
      log.quotaWarning({ date: '2026-11-18', count: 1700, quota: 2000 });
      log.notConfigured('Falta ORS_API_KEY');
      log.storageError('route_cache_get', new Error('KV'));
      log.storageError('route_cache_put', 'texto');
    } finally {
      Object.assign(console, original);
    }
    expect(out).toEqual([
      {
        event: 'ors_request',
        date: '2026-11-18',
        count: 5,
        quota: 2000,
        outcome: 'ok',
        durationMs: 120,
      },
      {
        event: 'ors_quota_warning',
        date: '2026-11-18',
        count: 1700,
        quota: 2000,
        message: 'Se usó el 85 % de la cuota diaria de OpenRouteService.',
      },
      { event: 'routing_not_configured', message: 'Falta ORS_API_KEY' },
      { event: 'routing_storage_error', operation: 'route_cache_get', error: 'KV' },
      { event: 'routing_storage_error', operation: 'route_cache_put', error: 'texto' },
    ]);
  });
});
