// Repositorios de tarifas y geocercas (HU-401) contra PostgreSQL + PostGIS reales: ST_Covers,
// ST_IsValid, historial en la misma sentencia y cursor. Requiere DATABASE_URL con las
// migraciones aplicadas; sin ella se omite. Deja las semillas como estaban.
import { PLACES, Role, type FareRuleUpdateBody } from '@panter/contracts';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDrizzleFareChangeRepository } from '../src/modules/pricing/infrastructure/drizzle-fare-change-repository';
import { createDrizzleFareRuleRepository } from '../src/modules/pricing/infrastructure/drizzle-fare-rule-repository';
import { createDrizzleGeofenceRepository } from '../src/modules/pricing/infrastructure/drizzle-geofence-repository';
import * as schema from '../src/shared/infrastructure/db/schema';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('repositorios de tarifas (integración)', () => {
  const client = postgres(url ?? '', { max: 4, onnotice: () => {} });
  const db = drizzle({ client, schema });
  const rules = createDrizzleFareRuleRepository(db);
  const geofences = createDrizzleGeofenceRepository(db);
  const changes = createDrizzleFareChangeRepository(db);
  const run = crypto.randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const geofenceIds: string[] = [];
  let admin = '';
  let passenger = '';
  let taxiBefore: typeof schema.fareRules.$inferSelect | undefined;

  async function user(name: string, roles: Role[]) {
    const [row] = await db
      .insert(schema.users)
      .values({ email: `it-fares-${run}-${name}@panter.test` })
      .returning();
    userIds.push(row!.id);
    await db.insert(schema.userRoles).values(roles.map((role) => ({ userId: row!.id, role })));
    return row!.id;
  }

  beforeAll(async () => {
    admin = await user('admin', [Role.PASSENGER, Role.ADMIN]);
    passenger = await user('pasajero', [Role.PASSENGER]);
    [taxiBefore] = await db
      .select()
      .from(schema.fareRules)
      .where(eq(schema.fareRules.vehicleType, 'TAXI'));
  });

  afterAll(async () => {
    if (taxiBefore) {
      await db
        .update(schema.fareRules)
        .set(taxiBefore)
        .where(eq(schema.fareRules.vehicleType, 'TAXI'));
    }
    if (geofenceIds.length > 0) {
      await db.delete(schema.geofences).where(inArray(schema.geofences.id, geofenceIds));
    }
    if (userIds.length > 0) {
      await db.delete(schema.fareChanges).where(inArray(schema.fareChanges.changedBy, userIds));
      await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    }
    await client.end();
  });

  const taxiBody = (patch: Partial<FareRuleUpdateBody> = {}): FareRuleUpdateBody => ({
    pricingModel: 'METERED',
    baseFare: 6000,
    perKm: 1200,
    perMinute: 150,
    minimumFare: 6000,
    nightSurcharge: 2000,
    nightStartMinute: 1200,
    nightEndMinute: 300,
    roundTo: 100,
    active: true,
    ...patch,
  });

  it('lista las reglas sembradas en el orden del enum', async () => {
    const list = await rules.list();
    expect(list.map((r) => r.vehicleType)).toEqual(['MOTOTAXI', 'TAXI', 'JEEP_4X4']);
    expect(list[0]).toMatchObject({ pricingModel: 'FLAT', baseFare: 3000, roundTo: 100 });
    expect(await rules.get('JEEP_4X4')).toMatchObject({ active: false });
  });

  it('edita una regla y registra antes, después y autor en la misma sentencia', async () => {
    const result = await rules.update({
      vehicleType: 'TAXI',
      actorId: admin,
      rule: taxiBody({ perKm: 1300 }),
    });
    expect(result).toMatchObject({ actorIsAdmin: true, exists: true, changed: true });
    const saved = await rules.get('TAXI');
    expect(saved).toMatchObject({ perKm: 1300, updatedBy: `it-fares-${run}-admin@panter.test` });

    const page = await changes.list({ limit: 1 });
    expect(page.items[0]).toMatchObject({
      entity: 'FARE_RULE',
      entityKey: 'TAXI',
      changedBy: `it-fares-${run}-admin@panter.test`,
    });
    expect(page.items[0]!.before).toMatchObject({ perKm: taxiBefore!.perKm, baseFare: 6000 });
    expect(page.items[0]!.after).toMatchObject({ perKm: 1300, nightStartMinute: 1200 });

    // Mismos valores: no cambia ni registra.
    const again = await rules.update({
      vehicleType: 'TAXI',
      actorId: admin,
      rule: taxiBody({ perKm: 1300 }),
    });
    expect(again.changed).toBe(false);
    expect((await changes.list({ limit: 1 })).items[0]!.id).toBe(page.items[0]!.id);
  });

  it('quien ya no es ADMIN en la base de datos no puede editar', async () => {
    const result = await rules.update({
      vehicleType: 'TAXI',
      actorId: passenger,
      rule: taxiBody({ perKm: 1 }),
    });
    expect(result).toMatchObject({ actorIsAdmin: false, changed: false });
    expect((await rules.get('TAXI'))!.perKm).not.toBe(1);
  });

  it('ST_Covers: el aeropuerto VGZ cae en su geocerca; el centro está en el hueco', async () => {
    const hits = await geofences.findCovering({
      origin: PLACES.VILLAGARZON_CENTER,
      destination: PLACES.AIRPORT_VGZ,
      vehicleType: 'TAXI',
    });
    expect(hits).toEqual([
      {
        id: '6c1f8a2e-0b7d-4f3a-9c51-1a2b3c4d5e01',
        name: 'Aeropuerto Cananguchal (VGZ)',
        kind: 'AIRPORT',
        surcharge: 5000,
      },
    ]);
    // La zona periférica solo aplica al mototaxi.
    const periphery = { lat: 1.05, lng: -76.6 };
    const moto = await geofences.findCovering({
      origin: PLACES.VILLAGARZON_CENTER,
      destination: periphery,
      vehicleType: 'MOTOTAXI',
    });
    expect(moto.map((g) => g.kind)).toEqual(['PERIPHERAL']);
    const taxi = await geofences.findCovering({
      origin: PLACES.VILLAGARZON_CENTER,
      destination: periphery,
      vehicleType: 'TAXI',
    });
    expect(taxi).toEqual([]);
  });

  it('la consulta espacial usa el índice GIST', async () => {
    await client`SET enable_seqscan = off`;
    try {
      const plan = await client.unsafe(
        `EXPLAIN SELECT id FROM geofences WHERE active AND 'TAXI'::vehicle_type = ANY (applies_to)
           AND (ST_Covers(area, 'SRID=4326;POINT(-76.6053 0.9789)'::geography)
             OR ST_Covers(area, 'SRID=4326;POINT(-76.6165 1.0295)'::geography))`,
      );
      expect(JSON.stringify(plan)).toContain('geofences_area_gist');
    } finally {
      await client`SET enable_seqscan = on`;
    }
  });

  it('edita una geocerca: valida con ST_IsValid y registra el polígono', async () => {
    const [row] = await db
      .insert(schema.geofences)
      .values({
        name: `Prueba ${run}`,
        kind: 'AIRPORT',
        area: [
          [
            { lat: 1.1, lng: -76.7 },
            { lat: 1.1, lng: -76.69 },
            { lat: 1.11, lng: -76.69 },
          ],
        ],
        surcharge: 100,
        appliesTo: ['TAXI'],
      })
      .returning();
    geofenceIds.push(row!.id);
    const square = [
      { lat: 1.1, lng: -76.7 },
      { lat: 1.1, lng: -76.69 },
      { lat: 1.11, lng: -76.69 },
      { lat: 1.11, lng: -76.7 },
    ];
    const body = {
      name: `Terminal ${run}`,
      polygon: [square],
      surcharge: 4000,
      appliesTo: ['MOTOTAXI' as const, 'TAXI' as const],
      active: true,
    };
    const result = await geofences.update({ id: row!.id, actorId: admin, geofence: body });
    expect(result).toMatchObject({
      actorIsAdmin: true,
      exists: true,
      changed: true,
      polygonValid: true,
    });
    expect(await geofences.get(row!.id)).toEqual({ id: row!.id, kind: 'AIRPORT', ...body });
    expect((await geofences.list()).some((g) => g.id === row!.id)).toBe(true);

    const [change] = (await changes.list({ limit: 1 })).items;
    expect(change).toMatchObject({ entity: 'GEOFENCE', entityKey: row!.id });
    expect(change!.after).toMatchObject({ name: `Terminal ${run}`, polygon: [square] });
    expect((change!.before as { polygon: unknown[][] }).polygon[0]).toHaveLength(3);

    expect((await geofences.update({ id: row!.id, actorId: admin, geofence: body })).changed).toBe(
      false,
    );

    // Moño (bordes que se cruzan): PostGIS lo marca inválido y no se escribe nada.
    const bowtie = await geofences.update({
      id: row!.id,
      actorId: admin,
      geofence: {
        ...body,
        polygon: [
          [
            { lat: 1.1, lng: -76.7 },
            { lat: 1.11, lng: -76.69 },
            { lat: 1.1, lng: -76.69 },
            { lat: 1.11, lng: -76.7 },
          ],
        ],
      },
    });
    expect(bowtie).toMatchObject({ polygonValid: false, changed: false });
    expect(bowtie.polygonReason).toMatch(/Self-intersection/);

    // Sin polígono (lo que envía hoy la web): se conserva el área y se edita el resto.
    const { polygon: _polygon, ...withoutPolygon } = body;
    const noPolygon = await geofences.update({
      id: row!.id,
      actorId: admin,
      geofence: { ...withoutPolygon, surcharge: 4500 },
    });
    expect(noPolygon).toMatchObject({ changed: true, polygonValid: true });
    expect(await geofences.get(row!.id)).toMatchObject({ surcharge: 4500, polygon: [square] });
    const [last] = (await changes.list({ limit: 1 })).items;
    expect(last!.before).toMatchObject({ surcharge: 4000, polygon: [square] });
    expect(last!.after).toMatchObject({ surcharge: 4500, polygon: [square] });

    const missing = await geofences.update({
      id: crypto.randomUUID(),
      actorId: admin,
      geofence: body,
    });
    expect(missing).toMatchObject({ exists: false, changed: false });
  });

  it('historial paginado con cursor (más reciente primero)', async () => {
    const first = await changes.list({ limit: 1 });
    expect(first.next).not.toBeNull();
    const second = await changes.list({ limit: 1, after: first.next! });
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    expect(Date.parse(second.items[0]!.changedAt)).toBeLessThanOrEqual(
      Date.parse(first.items[0]!.changedAt),
    );
    const all = await changes.list({ limit: 100 });
    expect(all.next).toBeNull();
  });
});
