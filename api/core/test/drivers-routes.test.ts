// HU-201: POST /drivers/apply, GET /drivers/me y el endurecimiento de POST /me/mode, en workerd.
import {
  AuthRoutes,
  DriverProfileSchema,
  DriverRoutes,
  PRIVACY_POLICY,
  Role,
  TokenPairResponseSchema,
} from '@panter/contracts';
import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildAuthFactories } from '../src/composition/auth';
import { buildConsentFactories } from '../src/composition/consent';
import {
  buildDriverFactories,
  defaultDriverAvailability,
  defaultDriverEligibility,
} from '../src/composition/drivers';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { createJoseAccessTokenSigner } from '../src/modules/auth/infrastructure/jose-access-tokens';
import { MemoryUserRepository } from './support/auth-fakes';
import { MemoryConsentRepository } from './support/consent-fakes';
import { MemoryDriverRepository } from './support/driver-fakes';
import { testKeys, type TestKeys } from './support/jwt-keys';

let keys: TestKeys;
beforeAll(async () => {
  keys = await testKeys();
});

const testEnv = (): Env => ({
  ...env,
  JWT_PUBLIC_KEY: keys.publicKeyPem,
  JWT_PRIVATE_KEY: keys.privateKeyPem,
});

interface ErrorJson {
  error: { code: string; message: string };
}

const vehicle = {
  vehicleType: 'TAXI',
  plate: 'tgk 482',
  brand: 'Chevrolet',
  model: 'Spark GT',
  color: 'Amarillo',
  year: 2019,
};

function setup() {
  const users = new MemoryUserRepository();
  const drivers = new MemoryDriverRepository();
  const consents = new MemoryConsentRepository();
  const app = createApp({
    auth: buildAuthFactories({
      users: () => users,
      driverAvailability: () => drivers,
      driverEligibility: () => drivers,
      consent: () => async () => ({
        required: false,
        currentVersion: PRIVACY_POLICY.version,
        acceptedVersion: PRIVACY_POLICY.version,
        acceptedAt: '2026-11-18T12:00:00.000Z',
      }),
    }),
    consent: buildConsentFactories({ repo: () => consents }),
    drivers: buildDriverFactories({ repo: () => drivers }),
  });
  const ana = users.add('ana@villagarzon.test');
  async function token(id = ana.id, roles: Role[] = [Role.PASSENGER], mode = 'passenger') {
    const signer = createJoseAccessTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: 'k' });
    return (await signer.sign({ userId: id, roles, activeMode: mode as 'passenger' })).token;
  }
  async function call(method: string, path: string, body?: unknown, auth?: string) {
    const headers: Record<string, string> = { authorization: `Bearer ${auth ?? (await token())}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    return app.request(
      path,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      testEnv(),
    );
  }
  async function accept(id = ana.id) {
    await consents.accept({
      userId: id,
      version: PRIVACY_POLICY.version,
      ip: null,
      userAgent: null,
    });
  }
  return { app, users, drivers, ana, token, call, accept };
}

async function codeOf(res: Response) {
  return [res.status, (await res.json<ErrorJson>()).error.code];
}

describe('POST /drivers/apply', () => {
  it('201 DriverProfile PENDING con la placa normalizada; no otorga DRIVER', async () => {
    const { call, accept, users, ana } = setup();
    await accept();
    const res = await call('POST', DriverRoutes.APPLY, vehicle);
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const profile = DriverProfileSchema.parse(await res.json());
    expect(profile).toMatchObject({
      userId: ana.id,
      verificationStatus: 'PENDING',
      availability: 'OFFLINE',
      vehicle: { plate: 'TGK482', vehicleType: 'TAXI' },
    });
    expect((await users.findById(ana.id))?.roles).toEqual([Role.PASSENGER]);
  });

  it('dos veces → 409 DRIVER_ALREADY_APPLIED; placa de otro → 409 PLATE_ALREADY_REGISTERED', async () => {
    const { call, accept, users, token } = setup();
    await accept();
    expect((await call('POST', DriverRoutes.APPLY, vehicle)).status).toBe(201);
    expect(await codeOf(await call('POST', DriverRoutes.APPLY, vehicle))).toEqual([
      409,
      'DRIVER_ALREADY_APPLIED',
    ]);
    const beto = users.add('beto@villagarzon.test');
    await accept(beto.id);
    expect(
      await codeOf(await call('POST', DriverRoutes.APPLY, vehicle, await token(beto.id))),
    ).toEqual([409, 'PLATE_ALREADY_REGISTERED']);
  });

  it('placa que no corresponde al tipo de vehículo → 400 VALIDATION_ERROR', async () => {
    const { call, accept } = setup();
    await accept();
    const res = await call('POST', DriverRoutes.APPLY, { ...vehicle, vehicleType: 'MOTOTAXI' });
    expect(res.status).toBe(400);
    const body = await res.json<{
      error: { code: string; details: { path: string; message: string }[] };
    }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details[0]).toMatchObject({
      path: 'plate',
      message: 'Placa de moto inválida (ej.: ABC12D)',
    });
  });

  it('sin aceptar el aviso de privacidad → 403 CONSENT_REQUIRED; sin token → 401', async () => {
    const { call } = setup();
    expect(await codeOf(await call('POST', DriverRoutes.APPLY, vehicle))).toEqual([
      403,
      'CONSENT_REQUIRED',
    ]);
    const anon = await exports.default.fetch(`https://api.test${DriverRoutes.APPLY}`, {
      method: 'POST',
    });
    expect(anon.status).toBe(401);
  });
});

describe('GET /drivers/me', () => {
  it('404 DRIVER_NOT_APPLIED sin perfil; luego el perfil con missingDocuments', async () => {
    const { call, accept } = setup();
    expect(await codeOf(await call('GET', DriverRoutes.ME))).toEqual([404, 'DRIVER_NOT_APPLIED']);
    await accept();
    await call('POST', DriverRoutes.APPLY, vehicle);
    const res = await call('GET', DriverRoutes.ME);
    expect(res.status).toBe(200);
    const profile = DriverProfileSchema.parse(await res.json());
    expect(profile.missingDocuments).toHaveLength(5);
    expect(profile.documents).toEqual([]);
  });
});

describe('POST /me/mode con el módulo drivers (HU-201)', () => {
  async function switchTo(ctx: ReturnType<typeof setup>, mode: string, roles: Role[]) {
    return ctx.call('POST', AuthRoutes.ME_MODE, { mode }, await ctx.token(ctx.ana.id, roles));
  }
  const driverRoles = [Role.PASSENGER, Role.DRIVER];

  it('DRIVER con verificación APPROVED entra en modo driver', async () => {
    const ctx = setup();
    ctx.users.users.get(ctx.ana.id)!.roles = driverRoles;
    ctx.drivers.seed(ctx.ana.id, 'APPROVED');
    const res = await switchTo(ctx, 'driver', driverRoles);
    expect(res.status).toBe(200);
    expect(TokenPairResponseSchema.parse(await res.json()).user.activeMode).toBe('driver');
  });

  it.each(['SUSPENDED', 'PENDING', 'REJECTED'] as const)(
    'DRIVER con verificación %s → 403 MODE_NOT_ALLOWED',
    async (status) => {
      const ctx = setup();
      ctx.users.users.get(ctx.ana.id)!.roles = driverRoles;
      ctx.drivers.seed(ctx.ana.id, status);
      expect(await codeOf(await switchTo(ctx, 'driver', driverRoles))).toEqual([
        403,
        'MODE_NOT_ALLOWED',
      ]);
    },
  );

  it('APPROVED sin el rol DRIVER (rol retirado) → 403 MODE_NOT_ALLOWED', async () => {
    const ctx = setup();
    ctx.drivers.seed(ctx.ana.id, 'APPROVED');
    expect(await codeOf(await switchTo(ctx, 'driver', driverRoles))).toEqual([
      403,
      'MODE_NOT_ALLOWED',
    ]);
  });

  it('pasar a passenger deja availability OFFLINE en driver_profiles', async () => {
    const ctx = setup();
    ctx.users.users.get(ctx.ana.id)!.roles = driverRoles;
    ctx.drivers.seed(ctx.ana.id, 'APPROVED').availability = 'AVAILABLE';
    const res = await ctx.call(
      'POST',
      AuthRoutes.ME_MODE,
      { mode: 'passenger' },
      await ctx.token(ctx.ana.id, driverRoles, 'driver'),
    );
    expect(res.status).toBe(200);
    expect(ctx.drivers.profiles.get(ctx.ana.id)?.availability).toBe('OFFLINE');
  });
});

describe('adaptadores por defecto (composition/drivers)', () => {
  it('sin DATABASE_URL fallan al usarse, no al armarse', async () => {
    const noDb = { ...env, DATABASE_URL: undefined };
    const availability = defaultDriverAvailability(noDb);
    const eligibility = defaultDriverEligibility(noDb);
    await expect(availability.setUnavailable('u')).rejects.toThrow(/DATABASE_URL/);
    await expect(eligibility.canUseDriverMode('u')).rejects.toThrow(/DATABASE_URL/);
  });
});
