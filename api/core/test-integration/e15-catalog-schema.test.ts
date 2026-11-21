// Esquema del catálogo geográfico (E15) contra PostGIS real: lugares iniciales, unicidad sin
// tildes por tipo, consulta espacial de barrios y lectura de polígonos y puntos.
// Requiere DATABASE_URL con las migraciones aplicadas; sin ella se omite.
import { PLACES, searchKey } from '@panter/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { toEwkt } from '../src/shared/infrastructure/db/geography';
import * as schema from '../src/shared/infrastructure/db/schema';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('catálogo E15 (integración)', () => {
  const client = postgres(url ?? '', { max: 2, onnotice: () => {} });
  const db = drizzle({ client, schema });
  const run = crypto.randomUUID().slice(0, 8);
  const areaIds: string[] = [];

  afterAll(async () => {
    if (areaIds.length > 0) await db.delete(schema.areas).where(inArray(schema.areas.id, areaIds));
    await client.end();
  });

  const centro = [
    [
      { lat: 1.02, lng: -76.628 },
      { lat: 1.02, lng: -76.605 },
      { lat: 1.04, lng: -76.605 },
      { lat: 1.04, lng: -76.628 },
    ],
  ];

  it('siembra los lugares clave; solo el aeropuerto está verificado', async () => {
    const rows = await db.select().from(schema.places);
    const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]));
    expect(bySlug['aeropuerto-cananguchal']).toMatchObject({ category: 'AIRPORT', verified: true });
    expect(bySlug['aeropuerto-cananguchal']!.location).toEqual({
      lat: PLACES.AIRPORT_VGZ.lat,
      lng: PLACES.AIRPORT_VGZ.lng,
    });
    expect(bySlug['rio-guineo']).toMatchObject({
      nameSearch: searchKey('Río Guineo'),
      verified: false,
    });
  });

  it('un barrio por nombre sin tildes y por tipo', async () => {
    const name = `Centro ${run}`;
    const [row] = await db
      .insert(schema.areas)
      .values({ name, nameSearch: searchKey(name), kind: 'BARRIO', polygon: centro })
      .returning();
    areaIds.push(row!.id);
    await expect(
      db.insert(schema.areas).values({
        name: name.toUpperCase(),
        nameSearch: searchKey(name.toUpperCase()),
        kind: 'BARRIO',
        polygon: centro,
      }),
    ).rejects.toThrow();
    const [vereda] = await db
      .insert(schema.areas)
      .values({ name, nameSearch: searchKey(name), kind: 'VEREDA', polygon: centro })
      .returning();
    areaIds.push(vereda!.id);
    expect(row!.polygon[0]).toHaveLength(4);
  });

  it('ubica un punto en su barrio con ST_Covers (índice GIST)', async () => {
    const name = `Locate ${run}`;
    const [row] = await db
      .insert(schema.areas)
      .values({ name, nameSearch: searchKey(name), kind: 'BARRIO', polygon: centro })
      .returning();
    areaIds.push(row!.id);
    const hit = await db
      .select({ id: schema.areas.id })
      .from(schema.areas)
      .where(
        and(
          eq(schema.areas.id, row!.id),
          sql`ST_Covers(${schema.areas.polygon}, ${toEwkt(PLACES.VILLAGARZON_CENTER)}::geography)`,
        ),
      );
    expect(hit).toHaveLength(1);
    const miss = await db
      .select({ id: schema.areas.id })
      .from(schema.areas)
      .where(
        and(
          eq(schema.areas.id, row!.id),
          sql`ST_Covers(${schema.areas.polygon}, ${toEwkt(PLACES.AIRPORT_VGZ)}::geography)`,
        ),
      );
    expect(miss).toHaveLength(0);
  });

  it('el slug del lugar es único y con formato', async () => {
    await expect(
      db.insert(schema.places).values({
        slug: 'aeropuerto-cananguchal',
        name: 'Duplicado',
        nameSearch: 'duplicado',
        category: 'OTHER',
        location: PLACES.AIRPORT_VGZ,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.places).values({
        slug: 'Con Espacios',
        name: 'Malo',
        nameSearch: 'malo',
        category: 'OTHER',
        location: PLACES.AIRPORT_VGZ,
      }),
    ).rejects.toThrow();
  });
});
