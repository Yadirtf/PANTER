// Esquema de M2 (conductores, tarifas, geocercas) contra PostGIS real: semillas, consultas
// espaciales con el índice GIST, restricciones y lectura del tipo geography(Polygon).
// Requiere DATABASE_URL con las migraciones aplicadas; sin ella se omite.
import { PLACES } from '@panter/contracts';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import * as schema from '../src/shared/infrastructure/db/schema';
import { toEwkt } from '../src/shared/infrastructure/db/geography';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('esquema M2 (integración)', () => {
  const client = postgres(url ?? '', { max: 2, onnotice: () => {} });
  const db = drizzle({ client, schema });
  const run = crypto.randomUUID().slice(0, 8);
  const userIds: string[] = [];

  afterAll(async () => {
    if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    await client.end();
  });

  async function user(name: string) {
    const [row] = await db
      .insert(schema.users)
      .values({ email: `it-m2-${run}-${name}@panter.test` })
      .returning();
    userIds.push(row!.id);
    return row!;
  }

  it('siembra las tarifas de la especificación (RF-05)', async () => {
    const rules = await db.select().from(schema.fareRules);
    const byType = Object.fromEntries(rules.map((r) => [r.vehicleType, r]));
    expect(byType.MOTOTAXI).toMatchObject({
      pricingModel: 'FLAT',
      baseFare: 3000,
      nightStartMinute: 1200,
    });
    expect(byType.TAXI).toMatchObject({ pricingModel: 'METERED', baseFare: 6000, active: true });
    expect(byType.JEEP_4X4?.active).toBe(false);
  });

  async function geofencesCovering(point: { lat: number; lng: number }) {
    return db
      .select({
        name: schema.geofences.name,
        kind: schema.geofences.kind,
        surcharge: schema.geofences.surcharge,
      })
      .from(schema.geofences)
      .where(sql`ST_Covers(${schema.geofences.area}, ${toEwkt(point)}::geography)`);
  }

  it('el aeropuerto VGZ cae en su geocerca con recargo de $5.000', async () => {
    expect(await geofencesCovering(PLACES.AIRPORT_VGZ)).toEqual([
      { name: 'Aeropuerto Cananguchal (VGZ)', kind: 'AIRPORT', surcharge: 5000 },
    ]);
  });

  it('el casco urbano es un hueco de la zona periférica', async () => {
    expect(await geofencesCovering(PLACES.VILLAGARZON_CENTER)).toEqual([]);
    expect((await geofencesCovering({ lat: 1.05, lng: -76.6 })).map((g) => g.kind)).toEqual([
      'PERIPHERAL',
    ]);
  });

  it('lee el polígono como anillos { lat, lng } (EWKB) incluido el hueco', async () => {
    const [peripheral] = await db
      .select()
      .from(schema.geofences)
      .where(eq(schema.geofences.kind, 'PERIPHERAL'));
    expect(peripheral!.area).toHaveLength(2);
    expect(peripheral!.area[0]).toHaveLength(4);
    expect(peripheral!.area[0]![0]).toEqual({ lat: 1, lng: -76.65 });
    expect(peripheral!.appliesTo).toEqual(['MOTOTAXI']);
  });

  it('escribe un polígono nuevo y lo consulta por punto', async () => {
    const [row] = await db
      .insert(schema.geofences)
      .values({
        name: `prueba-${run}`,
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
    try {
      const hit = await geofencesCovering({ lat: 1.103, lng: -76.692 });
      expect(hit.map((g) => g.name)).toContain(`prueba-${run}`);
    } finally {
      await db.delete(schema.geofences).where(eq(schema.geofences.id, row!.id));
    }
  });

  it('perfil y documentos de conductor: placa única y formato', async () => {
    const a = await user('a');
    const b = await user('b');
    const plate = `Q${run
      .slice(0, 2)
      .toUpperCase()
      .replace(/[^A-Z]/g, 'X')}12D`.slice(0, 6);
    const base = {
      vehicleType: 'MOTOTAXI' as const,
      brand: 'AKT',
      model: 'NKD',
      color: 'Rojo',
      year: 2022,
    };
    await db.insert(schema.driverProfiles).values({ ...base, userId: a.id, plate });
    await expect(
      db.insert(schema.driverProfiles).values({ ...base, userId: b.id, plate }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.driverProfiles).values({ ...base, userId: b.id, plate: 'abc-12' }),
    ).rejects.toThrow();

    await db.insert(schema.driverDocuments).values({
      userId: a.id,
      type: 'SOAT',
      r2Key: `drivers/${a.id}/SOAT/${crypto.randomUUID()}`,
      contentType: 'image/jpeg',
      sizeBytes: 1024,
    });
    const [doc] = await db
      .select()
      .from(schema.driverDocuments)
      .where(eq(schema.driverDocuments.userId, a.id));
    expect(doc).toMatchObject({ type: 'SOAT', status: 'SUBMITTED' });
    const [profile] = await db
      .select()
      .from(schema.driverProfiles)
      .where(eq(schema.driverProfiles.userId, a.id));
    expect(profile).toMatchObject({
      verificationStatus: 'PENDING',
      availability: 'OFFLINE',
      walletBalance: 0,
    });
  });
});
