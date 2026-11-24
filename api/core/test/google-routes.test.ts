// Rutas con Google Routes API: adaptador (fetch simulado) y GET /routes dentro de workerd cuando
// el Worker tiene GOOGLE_ROUTES_API_KEY.
import {
  encodePolyline,
  MapRoutes,
  PLACES,
  Role,
  RouteResponseSchema,
  type LatLng,
} from '@panter/contracts';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildAuthFactories } from '../src/composition/auth';
import {
  buildRoutingFactories,
  GOOGLE_ROUTES_DAILY_BUDGET,
  selectRouteProvider,
} from '../src/composition/routing';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import type { RouteProviderError } from '../src/modules/routing/application/ports';
import { createJoseAccessTokenSigner } from '../src/modules/auth/infrastructure/jose-access-tokens';
import {
  createGoogleRoutesProvider,
  GOOGLE_ROUTES_FIELD_MASK,
  GOOGLE_ROUTES_URL,
  googleRoutesBody,
  parseGoogleDuration,
} from '../src/modules/routing/infrastructure/google-routes-provider';
import type { FetchLike } from '../src/modules/routing/infrastructure/openrouteservice-route-provider';
import { MemoryUserRepository } from './support/auth-fakes';
import { RecordingRoutingLog } from './support/routing-fakes';
import { testKeys, type TestKeys } from './support/jwt-keys';

let keys: TestKeys;
beforeAll(async () => {
  keys = await testKeys();
});

const req = {
  origin: PLACES.VILLAGARZON_CENTER,
  destination: PLACES.AIRPORT_VGZ,
  profile: 'driving-car' as const,
};

/** Ruta en el formato de computeRoutes (solo los campos del field mask). */
function googleRoute(path: LatLng[], distanceMeters: number, duration = '600s') {
  return {
    distanceMeters,
    duration,
    polyline: { encodedPolyline: encodePolyline(path) },
    viewport: {
      low: { latitude: 0.97, longitude: -76.62 },
      high: { latitude: 1.04, longitude: -76.6 },
    },
  };
}

const direct = [PLACES.VILLAGARZON_CENTER, PLACES.AIRPORT_VGZ];
const detour = [PLACES.VILLAGARZON_CENTER, { lat: 1.03, lng: -76.55 }, PLACES.AIRPORT_VGZ];

describe('adaptador Google Routes', () => {
  async function reasonOf(fetch: FetchLike, apiKey: string | undefined = 'k') {
    try {
      await createGoogleRoutesProvider({ apiKey, fetch, now: () => 0 }).route(req);
    } catch (error) {
      const e = error as RouteProviderError;
      return { reason: e.reason, status: e.status, retryAfterSeconds: e.retryAfterSeconds };
    }
    throw new Error('se esperaba un error');
  }

  it('envía la clave y el field mask en cabeceras y pide el SKU Essentials', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const provider = createGoogleRoutesProvider({
      apiKey: ' google-key ',
      fetch: async (url, init) => {
        captured = { url, init };
        return Response.json({ routes: [googleRoute(direct, 6_200, '754s')] });
      },
    });
    const route = await provider.route(req);
    expect(captured?.url).toBe(GOOGLE_ROUTES_URL);
    expect(captured?.init.headers).toMatchObject({
      'x-goog-api-key': 'google-key',
      'x-goog-fieldmask': GOOGLE_ROUTES_FIELD_MASK,
    });
    expect(JSON.parse(String(captured?.init.body))).toEqual(googleRoutesBody(req));
    expect(googleRoutesBody(req)).toMatchObject({
      origin: { location: { latLng: { latitude: req.origin.lat, longitude: req.origin.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      computeAlternativeRoutes: true,
    });
    expect(route).toEqual({
      distanceMeters: 6_200,
      durationSeconds: 754,
      polyline: encodePolyline(direct),
      bbox: [-76.62, 0.97, -76.6, 1.04],
      alternatives: 1,
    });
  });

  it('con alternativas devuelve la más corta; sin viewport calcula el bbox', async () => {
    const provider = createGoogleRoutesProvider({
      apiKey: 'k',
      fetch: async () =>
        Response.json({
          routes: [
            googleRoute(detour, 19_300),
            { distanceMeters: 100 },
            { ...googleRoute(direct, 6_000), viewport: undefined },
          ],
        }),
    });
    const route = await provider.route(req);
    expect(route.distanceMeters).toBe(6_000);
    expect(route.alternatives).toBe(2);
    expect(route.bbox[1]).toBeCloseTo(PLACES.AIRPORT_VGZ.lat, 4);
    expect(route.bbox[3]).toBeCloseTo(PLACES.VILLAGARZON_CENTER.lat, 4);
  });

  it('origen = destino: Google omite distancia y duración', async () => {
    const provider = createGoogleRoutesProvider({
      apiKey: 'k',
      fetch: async () => Response.json({ routes: [{ polyline: { encodedPolyline: '_ibE_ibE' } }] }),
    });
    expect(await provider.route(req)).toEqual({
      distanceMeters: 0,
      durationSeconds: 0,
      polyline: '_ibE_ibE',
      bbox: [1, 1, 1, 1],
      alternatives: 1,
    });
  });

  it('traduce los fallos de Google', async () => {
    expect(await reasonOf(async () => Response.json({}), '  ')).toMatchObject({
      reason: 'not_configured',
    });
    expect(await reasonOf(async () => Response.json({}))).toMatchObject({ reason: 'not_found' });
    expect(await reasonOf(async () => new Response('', { status: 200 }))).toMatchObject({
      reason: 'not_found',
    });
    expect(
      await reasonOf(() => Promise.reject(new DOMException('timeout', 'TimeoutError'))),
    ).toMatchObject({ reason: 'unavailable' });
    expect(
      await reasonOf(async () =>
        Response.json({ error: { code: 403, status: 'PERMISSION_DENIED' } }, { status: 403 }),
      ),
    ).toMatchObject({ reason: 'unavailable', status: 403 });
    expect(
      await reasonOf(
        async () => new Response('{}', { status: 429, headers: { 'retry-after': '20' } }),
      ),
    ).toEqual({ reason: 'unavailable', status: 429, retryAfterSeconds: 20 });
    expect(await reasonOf(async () => new Response('<html>', { status: 200 }))).toMatchObject({
      reason: 'unavailable',
    });
  });

  it('duración "754s" → 754', () => {
    expect(parseGoogleDuration('754s')).toBe(754);
    expect(parseGoogleDuration('12.5s')).toBe(12.5);
    expect(parseGoogleDuration(undefined)).toBe(0);
    expect(parseGoogleDuration('pronto')).toBe(0);
  });
});

describe('elección del proveedor', () => {
  it('con GOOGLE_ROUTES_API_KEY usa Google y su presupuesto diario; si no, ORS', async () => {
    const calls: string[] = [];
    const fetch: FetchLike = async (url) => {
      calls.push(url);
      return url === GOOGLE_ROUTES_URL
        ? Response.json({ routes: [googleRoute(direct, 6_000)] })
        : Response.json({ routes: [] });
    };
    const google = selectRouteProvider(
      { ...env, GOOGLE_ROUTES_API_KEY: 'g', ORS_API_KEY: 'o' },
      { fetch },
    );
    expect(google.quota).toBe(GOOGLE_ROUTES_DAILY_BUDGET);
    await google.provider.route(req);
    expect(calls).toEqual([GOOGLE_ROUTES_URL]);

    const ors = selectRouteProvider(
      { ...env, GOOGLE_ROUTES_API_KEY: ' ', ORS_API_KEY: 'o' },
      { fetch },
    );
    expect(ors.quota).toBeUndefined();
    await expect(ors.provider.route(req)).rejects.toMatchObject({ reason: 'not_found' });
    expect(calls[1]).toMatch(/openrouteservice\.org\/v2\/directions\/driving-car$/);
  });

  it('GET /routes responde con la ruta de Google', async () => {
    const log = new RecordingRoutingLog();
    const app = createApp({
      auth: buildAuthFactories({ users: () => new MemoryUserRepository() }),
      routing: buildRoutingFactories({
        log,
        fetch: async () => Response.json({ routes: [googleRoute(direct, 6_100, '700s')] }),
      }),
    });
    const testEnv: Env = {
      ...env,
      JWT_PUBLIC_KEY: keys.publicKeyPem,
      ORS_API_KEY: undefined,
      GOOGLE_ROUTES_API_KEY: 'google-test-key',
    };
    const signer = createJoseAccessTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: 'k' });
    const { token } = await signer.sign({
      userId: crypto.randomUUID(),
      roles: [Role.PASSENGER],
      activeMode: 'passenger',
    });
    const o = { lat: 1.0011, lng: -76.6111 };
    const res = await app.request(
      `${MapRoutes.ROUTE}?origin=${o.lat},${o.lng}&destination=${PLACES.AIRPORT_VGZ.lat},${PLACES.AIRPORT_VGZ.lng}`,
      { headers: { authorization: `Bearer ${token}` } },
      testEnv,
    );
    expect(res.status).toBe(200);
    const body = RouteResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ distanceMeters: 6_100, durationSeconds: 700, cached: false });
  });
});
