// HU-310: /places y /admin/places dentro de workerd con repositorios en memoria (el SQL real se
// prueba en test-integration/catalog-places.test.ts). También GET /areas?ids=…&include=polygon.
import {
  ApiErrorCode,
  AreasWithPolygonResponseSchema,
  AreasResponseSchema,
  CatalogHistoryResponseSchema,
  NearbyPlacesResponseSchema,
  PLACES,
  PlaceRoutes,
  PlaceSchema,
  PlacesResponseSchema,
  Role,
  adminAreaPath,
  adminPlacePath,
} from '@panter/contracts';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildAuthFactories } from '../src/composition/auth';
import { buildAreaFactories, buildPlaceFactories } from '../src/composition/catalog';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { createJoseAccessTokenSigner } from '../src/modules/auth/infrastructure/jose-access-tokens';
import { CatalogCache } from '../src/modules/catalog/infrastructure/memory-catalog-cache';
import { MemoryUserRepository } from './support/auth-fakes';
import {
  CENTRO_POLYGON,
  MemoryAreaRepository,
  MemoryPlaceRepository,
  VEREDA_POLYGON,
} from './support/catalog-fakes';
import { testKeys, type TestKeys } from './support/jwt-keys';

let keys: TestKeys;
beforeAll(async () => {
  keys = await testKeys();
});

interface ErrorJson {
  error: { code: string; message: string; details?: unknown };
}

const ADMIN = '11111111-1111-4111-8111-111111111111';
const PASSENGER = '22222222-2222-4222-8222-222222222222';

function setup() {
  const areas = new MemoryAreaRepository();
  areas.admins.add(ADMIN);
  areas.emails.set(ADMIN, 'admin@panter.test');
  const centro = areas.seed('Centro', 'BARRIO', CENTRO_POLYGON);
  const vereda = areas.seed('Alto Guineo', 'VEREDA', VEREDA_POLYGON);
  const viejo = areas.seed('Viejo', 'BARRIO', CENTRO_POLYGON, false);
  const places = new MemoryPlaceRepository(areas);
  const airport = places.seed(
    'aeropuerto-cananguchal',
    'Aeropuerto Cananguchal',
    PLACES.AIRPORT_VGZ,
    {
      category: 'AIRPORT',
      verified: true,
    },
  );
  const parque = places.seed('parque-principal', 'Parque principal', PLACES.VILLAGARZON_CENTER, {
    category: 'PARK',
    area: { id: centro, name: 'Centro', kind: 'BARRIO', active: true },
  });
  const rio = places.seed(
    'rio-guineo',
    'Río Guineo',
    { lat: 0.99, lng: -76.65 },
    { category: 'TOURISM' },
  );
  const cerrado = places.seed('cerrado', 'Hotel cerrado', PLACES.VILLAGARZON_CENTER, {
    category: 'LODGING',
    active: false,
  });
  const cache = new CatalogCache();
  const app = createApp({
    auth: buildAuthFactories({ users: () => new MemoryUserRepository() }),
    areas: buildAreaFactories({ areas: () => areas, changes: () => areas.changes, cache }),
    places: buildPlaceFactories({ places: () => places, changes: () => areas.changes, cache }),
  });
  const testEnv: Env = { ...env, JWT_PUBLIC_KEY: keys.publicKeyPem };

  async function call(
    method: string,
    path: string,
    options: { as?: 'admin' | 'passenger'; body?: unknown } = {},
  ) {
    const headers: Record<string, string> = {};
    if (options.as) {
      const signer = createJoseAccessTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: 'k' });
      const roles = options.as === 'admin' ? [Role.PASSENGER, Role.ADMIN] : [Role.PASSENGER];
      const userId = options.as === 'admin' ? ADMIN : PASSENGER;
      headers.authorization = `Bearer ${(await signer.sign({ userId, roles, activeMode: 'passenger' })).token}`;
    }
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    return app.request(path, { method, headers, body }, testEnv);
  }
  return { areas, places, call, ids: { centro, vereda, viejo, airport, parque, rio, cerrado } };
}

describe('GET /places (público)', () => {
  it('catálogo con su barrio; búsqueda sin tildes, categoría y límite (máx. 100)', async () => {
    const { call, ids } = setup();
    const res = await call('GET', PlaceRoutes.LIST);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    const body = PlacesResponseSchema.parse(await res.json());
    expect(body.items.map((p) => p.slug)).toEqual([
      'aeropuerto-cananguchal',
      'parque-principal',
      'rio-guineo',
    ]);
    expect(body.items.find((p) => p.id === ids.parque)!.area).toEqual({
      id: ids.centro,
      name: 'Centro',
      kind: 'BARRIO',
      active: true,
    });
    expect(body.items.filter((p) => p.verified).map((p) => p.slug)).toEqual([
      'aeropuerto-cananguchal',
    ]);
    const rio = PlacesResponseSchema.parse(
      await (await call('GET', '/places?q=RIO%20guíneo')).json(),
    );
    expect(rio.items.map((p) => p.id)).toEqual([ids.rio]);
    const parks = PlacesResponseSchema.parse(
      await (await call('GET', '/places?category=PARK')).json(),
    );
    expect(parks.items.map((p) => p.id)).toEqual([ids.parque]);
    const two = PlacesResponseSchema.parse(await (await call('GET', '/places?limit=1')).json());
    expect(two.items).toHaveLength(1);
    expect((await call('GET', '/places?limit=100')).status).toBe(200);
    expect((await call('GET', '/places?limit=101')).status).toBe(400);
    expect((await call('GET', '/places?category=PLAYA')).status).toBe(400);
  });

  it('includeInactive solo con token de ADMIN', async () => {
    const { call, ids } = setup();
    expect((await call('GET', '/places?includeInactive=true')).status).toBe(403);
    const admin = await call('GET', '/places?includeInactive=true', { as: 'admin' });
    expect(admin.headers.get('Cache-Control')).toBe('no-store');
    expect(PlacesResponseSchema.parse(await admin.json()).items.map((p) => p.id)).toContain(
      ids.cerrado,
    );
  });
});

describe('GET /places/nearby (público)', () => {
  it('del más cercano al más lejano con distanceMeters; fuera del área → vacío', async () => {
    const { call, ids, places } = setup();
    const res = await call(
      'GET',
      `${PlaceRoutes.NEARBY}?lat=${PLACES.VILLAGARZON_CENTER.lat}&lng=${PLACES.VILLAGARZON_CENTER.lng}`,
    );
    expect(res.status).toBe(200);
    const body = NearbyPlacesResponseSchema.parse(await res.json());
    expect(body.items.map((p) => [p.id, p.distanceMeters])).toEqual([[ids.parque, 0]]);

    const wide = NearbyPlacesResponseSchema.parse(
      await (
        await call(
          'GET',
          `${PlaceRoutes.NEARBY}?lat=1.0295&lng=-76.6165&radiusMeters=2000&limit=20`,
        )
      ).json(),
    );
    expect(wide.items.map((p) => p.id)).toEqual([ids.parque]);
    const reads = places.reads;
    expect(
      NearbyPlacesResponseSchema.parse(
        await (await call('GET', `${PlaceRoutes.NEARBY}?lat=4.711&lng=-74.07`)).json(),
      ).items,
    ).toEqual([]);
    expect(places.reads).toBe(reads);
    expect(
      (await call('GET', `${PlaceRoutes.NEARBY}?lat=1&lng=-76.6&radiusMeters=5000`)).status,
    ).toBe(400);
  });
});

describe('/admin/places', () => {
  const terminal = {
    slug: 'terminal-de-transportes',
    name: 'Terminal de transportes',
    category: 'TRANSPORT',
    location: { lat: 1.028, lng: -76.615 },
    pickupPoint: { lat: 1.0282, lng: -76.6151 },
    source: '  Tomado con GPS en sitio  ',
  };

  it('crear: 201 con su barrio calculado, historial CREATE y caché invalidada', async () => {
    const { call, ids } = setup();
    await call('GET', PlaceRoutes.LIST); // llena la caché
    expect((await call('POST', PlaceRoutes.ADMIN_CREATE, { body: terminal })).status).toBe(401);
    expect(
      (await call('POST', PlaceRoutes.ADMIN_CREATE, { as: 'passenger', body: terminal })).status,
    ).toBe(403);
    const res = await call('POST', PlaceRoutes.ADMIN_CREATE, { as: 'admin', body: terminal });
    expect(res.status).toBe(201);
    const place = PlaceSchema.parse(await res.json());
    expect(place).toMatchObject({
      slug: 'terminal-de-transportes',
      area: { id: ids.centro, kind: 'BARRIO' },
      verified: false,
      source: 'Tomado con GPS en sitio',
      pickupPoint: { lat: 1.0282, lng: -76.6151 },
    });
    const list = PlacesResponseSchema.parse(await (await call('GET', PlaceRoutes.LIST)).json());
    expect(list.items.map((p) => p.slug)).toContain('terminal-de-transportes');
    const history = CatalogHistoryResponseSchema.parse(
      await (await call('GET', adminPlacePath(place.id, true), { as: 'admin' })).json(),
    );
    expect(history.items).toMatchObject([
      { entity: 'PLACE', action: 'CREATE', changedBy: 'admin@panter.test' },
    ]);
  });

  it('slug repetido → 409 PLACE_SLUG_TAKEN; slug con formato inválido → 400', async () => {
    const { call } = setup();
    const dup = await call('POST', PlaceRoutes.ADMIN_CREATE, {
      as: 'admin',
      body: { ...terminal, slug: 'parque-principal' },
    });
    expect(dup.status).toBe(409);
    expect((await dup.json<ErrorJson>()).error.code).toBe(ApiErrorCode.PLACE_SLUG_TAKEN);
    expect(
      (
        await call('POST', PlaceRoutes.ADMIN_CREATE, {
          as: 'admin',
          body: { ...terminal, slug: 'Terminal Nueva' },
        })
      ).status,
    ).toBe(400);
  });

  it('ubicación o recogida fuera del área de servicio → 422; recogida a más de 1 km → 400', async () => {
    const { call } = setup();
    const far = await call('POST', PlaceRoutes.ADMIN_CREATE, {
      as: 'admin',
      body: { ...terminal, location: { lat: 4.711, lng: -74.07 }, pickupPoint: null },
    });
    expect(far.status).toBe(422);
    expect((await far.json<ErrorJson>()).error).toMatchObject({
      code: ApiErrorCode.OUT_OF_SERVICE_AREA,
      details: { point: 'location' },
    });
    const pickup = await call('POST', PlaceRoutes.ADMIN_CREATE, {
      as: 'admin',
      body: { ...terminal, pickupPoint: { lat: 4.711, lng: -74.07 } },
    });
    expect((await pickup.json<ErrorJson>()).error.details).toEqual({ point: 'pickupPoint' });
    const tooFar = await call('POST', PlaceRoutes.ADMIN_CREATE, {
      as: 'admin',
      body: { ...terminal, pickupPoint: { lat: 1.04, lng: -76.615 } },
    });
    expect(tooFar.status).toBe(400);
    expect((await tooFar.json<ErrorJson>()).error.message).toBe(
      'El punto de recogida debe estar a menos de 1 km del lugar.',
    );
  });

  it('editar: verificar, corregir la ubicación (recalcula el barrio) y desactivar', async () => {
    const { call, ids } = setup();
    const res = await call('PATCH', adminPlacePath(ids.rio), {
      as: 'admin',
      body: { location: { lat: 1.045, lng: -76.64 }, verified: true },
    });
    expect(res.status).toBe(200);
    expect(PlaceSchema.parse(await res.json())).toMatchObject({
      verified: true,
      location: { lat: 1.045, lng: -76.64 },
      area: { id: ids.vereda, kind: 'VEREDA' },
    });
    // La recogida se valida contra la ubicación actual si no se envía una nueva.
    const tooFar = await call('PATCH', adminPlacePath(ids.rio), {
      as: 'admin',
      body: { pickupPoint: { lat: 1.03, lng: -76.64 } },
    });
    expect(tooFar.status).toBe(400);
    const off = await call('PATCH', adminPlacePath(ids.rio), {
      as: 'admin',
      body: { active: false, name: 'Río Guineo (charco)', source: null },
    });
    expect(PlaceSchema.parse(await off.json())).toMatchObject({ active: false, source: null });
    // Sin cambios no hay historial.
    await call('PATCH', adminPlacePath(ids.rio), { as: 'admin', body: { active: false } });
    const history = CatalogHistoryResponseSchema.parse(
      await (await call('GET', adminPlacePath(ids.rio, true), { as: 'admin' })).json(),
    );
    expect(history.items.map((i) => i.action)).toEqual(['UPDATE', 'UPDATE']);
    expect(
      (
        await call('PATCH', adminPlacePath(crypto.randomUUID()), {
          as: 'admin',
          body: { verified: true },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call('PATCH', adminPlacePath(crypto.randomUUID()), {
          as: 'admin',
          body: { location: { lat: 1.03, lng: -76.6 } },
        })
      ).status,
    ).toBe(404);
    expect(
      (await call('GET', `${adminPlacePath(ids.rio, true)}?cursor=x`, { as: 'admin' })).status,
    ).toBe(400);
  });
});

describe('GET /areas?ids=…&include=polygon', () => {
  it('varios barrios con polígono en una sola consulta, en el orden pedido', async () => {
    const { call, ids, areas } = setup();
    const reads = areas.reads;
    const res = await call(
      'GET',
      `/areas?ids=${ids.vereda},${ids.centro},${ids.viejo}&include=polygon`,
    );
    expect(res.status).toBe(200);
    const body = AreasWithPolygonResponseSchema.parse(await res.json());
    expect(body.items.map((a) => a.id)).toEqual([ids.vereda, ids.centro]);
    expect(body.items[1]!.polygon).toEqual(CENTRO_POLYGON);
    expect(body.items[1]!.updatedBy).toBeNull();
    expect(areas.reads).toBe(reads + 1);

    const summaries = AreasResponseSchema.parse(
      await (
        await call('GET', `/areas?ids=${ids.viejo},${ids.centro}&includeInactive=true`, {
          as: 'admin',
        })
      ).json(),
    );
    expect(summaries.items).toEqual([
      { id: ids.viejo, name: 'Viejo', kind: 'BARRIO', active: false },
      { id: ids.centro, name: 'Centro', kind: 'BARRIO', active: true },
    ]);
    expect(summaries.items[0]).not.toHaveProperty('polygon');
    const admin = AreasWithPolygonResponseSchema.parse(
      await (await call('GET', `/areas?ids=${ids.centro}&include=polygon`, { as: 'admin' })).json(),
    );
    expect(admin.items).toHaveLength(1);

    expect((await call('GET', '/areas?include=polygon')).status).toBe(400);
    expect((await call('GET', '/areas?ids=no-es-uuid')).status).toBe(400);
    const tooMany = Array.from({ length: 101 }, () => crypto.randomUUID()).join(',');
    expect((await call('GET', `/areas?ids=${tooMany}`)).status).toBe(400);
  });

  it('editar un barrio vacía también la caché de lugares', async () => {
    const { call, ids, places } = setup();
    await call('GET', PlaceRoutes.LIST);
    const reads = places.reads;
    await call('GET', PlaceRoutes.LIST);
    expect(places.reads).toBe(reads);
    await call('PATCH', adminAreaPath(ids.centro), {
      as: 'admin',
      body: { name: 'Centro urbano' },
    });
    await call('GET', PlaceRoutes.LIST);
    expect(places.reads).toBe(reads + 1);
  });
});
