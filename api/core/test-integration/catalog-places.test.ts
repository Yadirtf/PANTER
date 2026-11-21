// HU-310: lugares de interés contra PostgreSQL + PostGIS reales: lugares sembrados en 0007,
// búsqueda sin tildes, ST_DWithin ordenado por distancia, area_id con ST_Covers al guardar,
// slug único, actor ADMIN en la base de datos e historial. Requiere DATABASE_URL; sin ella se omite.
import { PLACES, Role, type LatLng } from '@panter/contracts';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeListCatalogHistory } from '../src/modules/catalog/application/history';
import type { PlaceDraft } from '../src/modules/catalog/application/ports';
import { createDrizzleAreaRepository } from '../src/modules/catalog/infrastructure/drizzle-area-repository';
import { createDrizzleCatalogChangeRepository } from '../src/modules/catalog/infrastructure/drizzle-catalog-change-repository';
import {
  createDrizzlePlaceRepository,
  PLACE_SLUG_CONSTRAINT,
} from '../src/modules/catalog/infrastructure/drizzle-place-repository';
import type { AnyPgDatabase } from '../src/modules/auth/infrastructure/drizzle-user-repository';
import * as schema from '../src/shared/infrastructure/db/schema';

const url = process.env.DATABASE_URL;

const SEEDED = [
  'aeropuerto-cananguchal',
  'parque-principal',
  'pozo-azul',
  'rio-guineo',
  'cascadas-de-vica',
  'mohano',
];

describe.skipIf(!url)('lugares de interés (integración)', () => {
  const client = postgres(url ?? '', { max: 4, onnotice: () => {} });
  const db = drizzle({ client, schema });
  const places = createDrizzlePlaceRepository(db);
  const areas = createDrizzleAreaRepository(db);
  const history = makeListCatalogHistory({
    changes: createDrizzleCatalogChangeRepository(db),
    entity: 'PLACE',
  });
  const run = crypto.randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const placeIds: string[] = [];
  const areaIds: string[] = [];
  let admin = '';
  let passenger = '';
  let barrioId = '';

  // Barrio de prueba al oriente del parque principal, lejos de los lugares sembrados.
  const BARRIO: LatLng[][] = [
    [
      { lat: 1.02, lng: -76.6 },
      { lat: 1.02, lng: -76.59 },
      { lat: 1.03, lng: -76.59 },
      { lat: 1.03, lng: -76.6 },
    ],
  ];
  const INSIDE = { lat: 1.025, lng: -76.595 };
  const OUTSIDE = { lat: 1.04, lng: -76.58 };

  async function user(name: string, roles: Role[]) {
    const [row] = await db
      .insert(schema.users)
      .values({ email: `it-places-${run}-${name}@panter.test` })
      .returning();
    userIds.push(row!.id);
    await db.insert(schema.userRoles).values(roles.map((role) => ({ userId: row!.id, role })));
    return row!.id;
  }

  const draft = (slug: string, extra: Partial<PlaceDraft> = {}): PlaceDraft => ({
    slug,
    name: `Terminal ${run}`,
    nameSearch: `terminal ${run}`,
    category: 'TRANSPORT',
    location: INSIDE,
    pickupPoint: null,
    verified: false,
    source: 'Prueba de integración',
    ...extra,
  });

  beforeAll(async () => {
    admin = await user('admin', [Role.PASSENGER, Role.ADMIN]);
    passenger = await user('pasajero', [Role.PASSENGER]);
    const created = await areas.create({
      actorId: admin,
      area: {
        name: `Oriente ${run}`,
        nameSearch: `oriente ${run}`,
        kind: 'BARRIO',
        polygon: BARRIO,
        source: null,
      },
    });
    barrioId = created.id!;
    areaIds.push(barrioId);
  });

  afterAll(async () => {
    const ids = [...placeIds, ...areaIds];
    if (ids.length > 0) {
      await db.delete(schema.catalogChanges).where(inArray(schema.catalogChanges.entityId, ids));
    }
    if (placeIds.length > 0) {
      await db.delete(schema.places).where(inArray(schema.places.id, placeIds));
    }
    if (areaIds.length > 0) await db.delete(schema.areas).where(inArray(schema.areas.id, areaIds));
    if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    await client.end();
  });

  it('los 6 lugares sembrados aparecen y solo el aeropuerto está verificado', async () => {
    const all = await places.list({ includeInactive: false, limit: 100 });
    const seeded = all.filter((p) => SEEDED.includes(p.slug));
    expect(seeded.map((p) => p.slug).sort()).toEqual([...SEEDED].sort());
    expect(seeded.filter((p) => p.verified).map((p) => p.slug)).toEqual(['aeropuerto-cananguchal']);
    const airport = seeded.find((p) => p.slug === 'aeropuerto-cananguchal')!;
    expect(airport).toMatchObject({
      name: 'Aeropuerto Cananguchal',
      category: 'AIRPORT',
      location: PLACES.AIRPORT_VGZ,
      pickupPoint: null,
      active: true,
    });
    expect(airport.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // Ordenados por nombre.
    expect(all.map((p) => p.name)).toEqual(
      [...all.map((p) => p.name)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });

  it('búsqueda sin tildes (ILIKE sobre name_search), categoría y límite', async () => {
    const rio = await places.list({ search: 'rio guineo', includeInactive: false, limit: 10 });
    expect(rio.map((p) => p.slug)).toEqual(['rio-guineo']);
    const tourism = await places.list({ category: 'TOURISM', includeInactive: false, limit: 100 });
    expect(tourism.map((p) => p.slug)).toEqual(
      expect.arrayContaining(['pozo-azul', 'rio-guineo', 'cascadas-de-vica', 'mohano']),
    );
    expect(tourism.every((p) => p.category === 'TOURISM')).toBe(true);
    expect(await places.list({ includeInactive: false, limit: 2 })).toHaveLength(2);
  });

  it('nearby con ST_DWithin, del más cercano al más lejano, con distanceMeters', async () => {
    const near = await places.nearby({
      point: PLACES.VILLAGARZON_CENTER,
      radiusMeters: 300,
      limit: 5,
    });
    expect(near[0]).toMatchObject({ slug: 'parque-principal', distanceMeters: 0 });
    const wide = await places.nearby({
      point: PLACES.VILLAGARZON_CENTER,
      radiusMeters: 2000,
      limit: 20,
    });
    expect(wide.every((p) => p.distanceMeters <= 2000)).toBe(true);
    const sorted = [...wide].sort((a, b) => a.distanceMeters - b.distanceMeters);
    expect(wide.map((p) => p.id)).toEqual(sorted.map((p) => p.id));
    // El aeropuerto está a ~5,6 km: no aparece.
    expect(wide.map((p) => p.slug)).not.toContain('aeropuerto-cananguchal');
  });

  it('crear: área calculada con ST_Covers, slug único, solo ADMIN, historial CREATE', async () => {
    const created = await places.create({
      actorId: admin,
      place: draft(`terminal-${run}`, { pickupPoint: { lat: 1.0251, lng: -76.5951 } }),
    });
    expect(created).toMatchObject({ actorIsAdmin: true, slugTaken: false, changed: true });
    placeIds.push(created.id!);
    const place = await places.get(created.id!);
    expect(place).toMatchObject({
      slug: `terminal-${run}`,
      category: 'TRANSPORT',
      location: INSIDE,
      pickupPoint: { lat: 1.0251, lng: -76.5951 },
      area: { id: barrioId, name: `Oriente ${run}`, kind: 'BARRIO', active: true },
      verified: false,
    });
    expect(await places.get(crypto.randomUUID())).toBeNull();

    expect(await places.create({ actorId: admin, place: draft(`terminal-${run}`) })).toMatchObject({
      slugTaken: true,
      changed: false,
      id: null,
    });
    expect(
      await places.create({ actorId: passenger, place: draft(`intruso-${run}`) }),
    ).toMatchObject({ actorIsAdmin: false, slugTaken: false, changed: false });

    const page = await history(created.id!, { limit: 5 });
    expect(page.items).toMatchObject([
      {
        entity: 'PLACE',
        action: 'CREATE',
        before: null,
        after: {
          slug: `terminal-${run}`,
          location: INSIDE,
          pickupPoint: { lat: 1.0251, lng: -76.5951 },
          areaId: barrioId,
        },
        changedBy: `it-places-${run}-admin@panter.test`,
      },
    ]);
  });

  it('editar: mover recalcula el área, verificar, quitar la recogida; sin cambios no hay historial', async () => {
    const id = placeIds[0]!;
    const moved = await places.update({
      id,
      actorId: admin,
      patch: { location: OUTSIDE, verified: true, pickupPoint: null, source: null },
    });
    expect(moved).toMatchObject({ exists: true, changed: true });
    expect(await places.get(id)).toMatchObject({
      location: OUTSIDE,
      area: null,
      verified: true,
      pickupPoint: null,
      source: null,
    });
    expect((await places.update({ id, actorId: admin, patch: { verified: true } })).changed).toBe(
      false,
    );
    await places.update({
      id,
      actorId: admin,
      patch: {
        location: INSIDE,
        name: `Terminal de Villagarzón ${run}`,
        nameSearch: `terminal de villagarzon ${run}`,
        category: 'TRANSPORT',
        active: false,
      },
    });
    const back = await places.get(id);
    expect(back).toMatchObject({ area: { id: barrioId }, active: false });
    expect(
      await places.list({
        search: `terminal de villagarzon ${run}`,
        includeInactive: false,
        limit: 5,
      }),
    ).toEqual([]);
    expect(
      await places.list({
        search: `terminal de villagarzon ${run}`,
        includeInactive: true,
        limit: 5,
      }),
    ).toHaveLength(1);
    expect(
      (await places.nearby({ point: INSIDE, radiusMeters: 50, limit: 5 })).map((p) => p.id),
    ).not.toContain(id);

    expect(
      await places.update({ id, actorId: passenger, patch: { verified: false } }),
    ).toMatchObject({ actorIsAdmin: false, changed: false });
    expect(
      await places.update({ id: crypto.randomUUID(), actorId: admin, patch: { verified: false } }),
    ).toMatchObject({ exists: false });

    const page = await history(id, { limit: 10 });
    expect(page.items.map((i) => i.action)).toEqual(['UPDATE', 'UPDATE', 'CREATE']);
    expect(page.items[1]).toMatchObject({
      before: { areaId: barrioId, verified: false },
      after: { areaId: null, verified: true, location: OUTSIDE },
    });
  });

  it('editar el barrio recalcula el área de los lugares; getMany trae varios con polígono', async () => {
    await areas.update({ id: barrioId, actorId: admin, patch: { active: false } });
    expect((await places.get(placeIds[0]!))!.area).toBeNull();
    await areas.update({ id: barrioId, actorId: admin, patch: { active: true } });
    expect((await places.get(placeIds[0]!))!.area?.id).toBe(barrioId);
    const many = await areas.getMany([barrioId, crypto.randomUUID()]);
    expect(many).toHaveLength(1);
    expect(many[0]!.polygon).toEqual(BARRIO);
    expect(await areas.getMany([])).toEqual([]);
  });

  it('un slug repetido en paralelo (23505) se informa como slugTaken', async () => {
    const racing = createDrizzlePlaceRepository({
      execute: () =>
        Promise.reject(
          Object.assign(new Error('duplicate key'), {
            code: '23505',
            constraint: PLACE_SLUG_CONSTRAINT,
          }),
        ),
    } as unknown as AnyPgDatabase);
    expect(await racing.create({ actorId: admin, place: draft(`x-${run}`) })).toMatchObject({
      slugTaken: true,
    });
    const broken = createDrizzlePlaceRepository({
      execute: () => Promise.reject(new Error('conexión')),
    } as unknown as AnyPgDatabase);
    await expect(broken.create({ actorId: admin, place: draft(`y-${run}`) })).rejects.toThrow(
      'conexión',
    );
  });
});
