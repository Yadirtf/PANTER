// HU-402: POST /fares/estimate dentro de workerd: ruta de HU-305 con KV de Miniflare y fetch
// simulado de ORS (misma caché que GET /routes), repositorios de tarifas en memoria.
import {
  ApiErrorCode,
  FareEstimateResponseSchema,
  FareRoutes,
  MapRoutes,
  PLACES,
  Role,
} from '@panter/contracts';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildAuthFactories } from '../src/composition/auth';
import { buildPricingFactories } from '../src/composition/pricing';
import { buildRoutingFactories } from '../src/composition/routing';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { createJoseAccessTokenSigner } from '../src/modules/auth/infrastructure/jose-access-tokens';
import { FareCache } from '../src/modules/pricing/infrastructure/memory-fare-catalog';
import type { FetchLike } from '../src/modules/routing/infrastructure/openrouteservice-route-provider';
import orsFixture from './fixtures/ors-directions-centro-vgz.json';
import { MemoryUserRepository } from './support/auth-fakes';
import { testKeys, type TestKeys } from './support/jwt-keys';
import { memoryPricing } from './support/pricing-fakes';
import { RecordingRoutingLog } from './support/routing-fakes';

let keys: TestKeys;
beforeAll(async () => {
  keys = await testKeys();
});

let seq = 0;
/** Origen distinto por prueba (la caché KV se comparte dentro del archivo), en el casco urbano. */
const uniqueOrigin = () => ({ lat: 1.0295 + ++seq / 10_000, lng: -76.6165 });

function setup(envOverrides: Partial<Env> = {}) {
  const ors: string[] = [];
  const fetch: FetchLike = async (url) => {
    ors.push(url);
    return Response.json(orsFixture);
  };
  const repos = memoryPricing();
  const routing = { fetch, log: new RecordingRoutingLog() };
  const app = createApp({
    auth: buildAuthFactories({ users: () => new MemoryUserRepository() }),
    routing: buildRoutingFactories(routing),
    pricing: buildPricingFactories({
      rules: () => repos.rules,
      geofences: () => repos.geofences,
      routing,
      cache: new FareCache(),
      clock: () => Date.parse('2026-11-18T19:00:00Z'),
    }),
  });
  const testEnv: Env = {
    ...env,
    JWT_PUBLIC_KEY: keys.publicKeyPem,
    ORS_API_KEY: 'ors-test-key',
    ...envOverrides,
  };
  async function token() {
    const signer = createJoseAccessTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: 'k' });
    return (
      await signer.sign({
        userId: crypto.randomUUID(),
        roles: [Role.PASSENGER],
        activeMode: 'passenger',
      })
    ).token;
  }
  async function estimate(body: unknown, auth = true) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (auth) headers.authorization = `Bearer ${await token()}`;
    return app.request(
      FareRoutes.ESTIMATE,
      { method: 'POST', headers, body: JSON.stringify(body) },
      testEnv,
    );
  }
  async function route(origin: { lat: number; lng: number }) {
    return app.request(
      `${MapRoutes.ROUTE}?origin=${origin.lat},${origin.lng}&destination=${PLACES.AIRPORT_VGZ.lat},${PLACES.AIRPORT_VGZ.lng}`,
      { headers: { authorization: `Bearer ${await token()}` } },
      testEnv,
    );
  }
  return { estimate, route, ors, repos };
}

interface ErrorJson {
  error: { code: string; message: string };
}

describe('POST /fares/estimate', () => {
  it('taxi al aeropuerto VGZ: total con desglose; reutiliza la ruta de GET /routes', async () => {
    const { estimate, route, ors } = setup();
    const origin = uniqueOrigin();
    expect((await route(origin)).status).toBe(200);
    expect(ors).toHaveLength(1);

    const res = await estimate({ origin, destination: PLACES.AIRPORT_VGZ, vehicleType: 'TAXI' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = FareEstimateResponseSchema.parse(await res.json());
    expect(body).toMatchObject({
      total: 19500,
      currency: 'COP',
      isNight: false,
      validUntil: '2026-11-18T19:10:00.000Z',
    });
    expect(body.breakdown).toContainEqual({
      code: 'AIRPORT',
      label: 'Recargo aeropuerto Cananguchal (VGZ)',
      amount: 5000,
    });
    // El estimado salió de la caché de rutas: no consumió cuota de ORS.
    expect(ors).toHaveLength(1);
  });

  it('mototaxi de noche (reserva a las 22:00)', async () => {
    const { estimate } = setup();
    const res = await estimate({
      origin: uniqueOrigin(),
      destination: PLACES.AIRPORT_VGZ,
      vehicleType: 'MOTOTAXI',
      departAt: '2026-11-19T03:00:00Z',
    });
    const body = FareEstimateResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ total: 9000, isNight: true });
    expect(body.breakdown.map((x) => x.code)).toEqual(['BASE', 'NIGHT', 'AIRPORT']);
  });

  it('errores: sin token 401, cuerpo inválido 400, 4x4 inactivo 404, fuera del área 422', async () => {
    const { estimate, ors } = setup();
    const trip = { origin: uniqueOrigin(), destination: PLACES.AIRPORT_VGZ, vehicleType: 'TAXI' };
    expect((await estimate(trip, false)).status).toBe(401);
    expect((await estimate({ ...trip, vehicleType: 'BUS' })).status).toBe(400);
    const jeep = await estimate({ ...trip, vehicleType: 'JEEP_4X4' });
    expect(jeep.status).toBe(404);
    expect((await jeep.json<ErrorJson>()).error.code).toBe(ApiErrorCode.FARE_RULE_NOT_FOUND);
    const far = await estimate({ ...trip, destination: { lat: 4.711, lng: -74.0721 } });
    expect(far.status).toBe(422);
    expect((await far.json<ErrorJson>()).error.code).toBe(ApiErrorCode.OUT_OF_SERVICE_AREA);
    expect(ors).toHaveLength(0);
  });

  it('sin ORS_API_KEY → 503 ROUTING_UNAVAILABLE claro', async () => {
    const { estimate } = setup({ ORS_API_KEY: undefined });
    const res = await estimate({
      origin: uniqueOrigin(),
      destination: PLACES.AIRPORT_VGZ,
      vehicleType: 'TAXI',
    });
    expect(res.status).toBe(503);
    expect((await res.json<ErrorJson>()).error.code).toBe(ApiErrorCode.ROUTING_UNAVAILABLE);
  });
});
