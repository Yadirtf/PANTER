// HU-401: /admin/fares dentro de workerd, con repositorios en memoria.
import {
  FareConfigResponseSchema,
  FareHistoryResponseSchema,
  FareRoutes,
  FareRuleSchema,
  fareGeofencePath,
  fareRulePath,
  GeofenceSchema,
  Role,
} from '@panter/contracts';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildAuthFactories } from '../src/composition/auth';
import { buildPricingAdminFactories } from '../src/composition/pricing';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { createJoseAccessTokenSigner } from '../src/modules/auth/infrastructure/jose-access-tokens';
import { MemoryUserRepository } from './support/auth-fakes';
import { testKeys, type TestKeys } from './support/jwt-keys';
import { AIRPORT_ID, memoryPricing, SEED_GEOFENCES, SEED_RULES } from './support/pricing-fakes';

let keys: TestKeys;
beforeAll(async () => {
  keys = await testKeys();
});

const ADMIN_ID = '00000000-0000-4000-8000-00000000aaaa';

function setup() {
  const repos = memoryPricing();
  repos.store.admins.set(ADMIN_ID, 'admin@panter.test');
  let changes = 0;
  const app = createApp({
    auth: buildAuthFactories({ users: () => new MemoryUserRepository() }),
    pricingAdmin: buildPricingAdminFactories({
      rules: () => repos.rules,
      geofences: () => repos.geofences,
      changes: () => repos.changes,
      onChange: () => changes++,
    }),
  });
  async function call(
    method: string,
    path: string,
    options: { body?: unknown; roles?: Role[] } = {},
  ) {
    const signer = createJoseAccessTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: 'k' });
    const { token } = await signer.sign({
      userId: ADMIN_ID,
      roles: options.roles ?? [Role.PASSENGER, Role.ADMIN],
      activeMode: 'passenger',
    });
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const testEnv: Env = { ...env, JWT_PUBLIC_KEY: keys.publicKeyPem };
    return app.request(
      path,
      {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      testEnv,
    );
  }
  return { repos, call, changes: () => changes };
}

const taxiBody = (({ vehicleType: _v, updatedAt: _a, updatedBy: _b, ...r }) => r)(SEED_RULES[1]!);
const airportBody = (({ id: _id, kind: _k, ...g }) => g)(SEED_GEOFENCES[0]!);

interface ErrorJson {
  error: { code: string; details?: unknown };
}

describe('/admin/fares', () => {
  it('GET devuelve la configuración (FareConfigResponse); solo ADMIN', async () => {
    const { call } = setup();
    const res = await call('GET', FareRoutes.ADMIN_CONFIG);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const config = FareConfigResponseSchema.parse(await res.json());
    expect(config.rules).toHaveLength(3);
    expect(config.geofences.map((g) => g.kind)).toEqual(['AIRPORT', 'PERIPHERAL']);

    const dispatcher = await call('GET', FareRoutes.ADMIN_CONFIG, { roles: [Role.DISPATCHER] });
    expect(dispatcher.status).toBe(403);
    expect((await app401()).status).toBe(401);
  });

  async function app401() {
    return createApp().request(FareRoutes.ADMIN_CONFIG, {}, env);
  }

  it('PUT de una regla: guarda, registra el historial y avisa el cambio', async () => {
    const { call, changes } = setup();
    const res = await call('PUT', fareRulePath('TAXI'), { body: { ...taxiBody, perKm: 1300 } });
    expect(res.status).toBe(200);
    expect(FareRuleSchema.parse(await res.json())).toMatchObject({
      vehicleType: 'TAXI',
      perKm: 1300,
      updatedBy: 'admin@panter.test',
    });
    expect(changes()).toBe(1);

    const history = FareHistoryResponseSchema.parse(
      await (await call('GET', `${FareRoutes.ADMIN_HISTORY}?limit=10`)).json(),
    );
    expect(history.items[0]).toMatchObject({ entity: 'FARE_RULE', entityKey: 'TAXI' });
  });

  it('PUT de una regla inválida → 400 con details; tipo desconocido → 400', async () => {
    const { call } = setup();
    const res = await call('PUT', fareRulePath('TAXI'), { body: { ...taxiBody, roundTo: 300 } });
    expect(res.status).toBe(400);
    const body = await res.json<ErrorJson>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual([expect.objectContaining({ path: 'roundTo' })]);
    expect((await call('PUT', '/admin/fares/rules/BUS', { body: taxiBody })).status).toBe(400);
    expect(
      (await call('PUT', fareRulePath('TAXI'), { body: { ...taxiBody, baseFare: -5 } })).status,
    ).toBe(400);
  });

  it('PUT de una geocerca: valida el polígono', async () => {
    const { call } = setup();
    const ok = await call('PUT', fareGeofencePath(AIRPORT_ID), {
      body: { ...airportBody, surcharge: 6000 },
    });
    expect(ok.status).toBe(200);
    expect(GeofenceSchema.parse(await ok.json()).surcharge).toBe(6000);

    // Cuerpo de la web (#116): sin polígono.
    const web = await call('PUT', fareGeofencePath(AIRPORT_ID), {
      body: { name: 'Aeropuerto VGZ', surcharge: 5500, appliesTo: ['TAXI'], active: true },
    });
    expect(web.status).toBe(200);
    expect(GeofenceSchema.parse(await web.json())).toMatchObject({
      surcharge: 5500,
      polygon: airportBody.polygon,
    });

    const outside = await call('PUT', fareGeofencePath(AIRPORT_ID), {
      body: {
        ...airportBody,
        polygon: [
          [
            { lat: 4.7, lng: -74.1 },
            { lat: 4.7, lng: -74 },
            { lat: 4.8, lng: -74 },
          ],
        ],
      },
    });
    expect(outside.status).toBe(400);
    expect((await call('PUT', fareGeofencePath('no-es-uuid'), { body: airportBody })).status).toBe(
      400,
    );
    expect(
      (await call('PUT', fareGeofencePath(crypto.randomUUID()), { body: airportBody })).status,
    ).toBe(404);
  });

  it('historial: cursor inválido → 400', async () => {
    const { call } = setup();
    expect((await call('GET', `${FareRoutes.ADMIN_HISTORY}?cursor=xx`)).status).toBe(400);
    const empty = FareHistoryResponseSchema.parse(
      await (await call('GET', FareRoutes.ADMIN_HISTORY)).json(),
    );
    expect(empty).toEqual({ items: [], nextCursor: null });
  });
});
