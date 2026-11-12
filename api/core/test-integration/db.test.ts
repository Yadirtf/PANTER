// Integración contra PostgreSQL + PostGIS reales (contenedor postgis/postgis en CI, rama Neon o
// PostGIS local en desarrollo). Requiere DATABASE_URL con `pnpm db:migrate` ya aplicado; sin
// DATABASE_URL se omite para que `pnpm test` y este script funcionen sin base de datos.
import { Role } from '@panter/contracts';
import { eq, sql } from 'drizzle-orm';
import { pgTable, uuid } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { geographyPoint } from '../src/shared/infrastructure/db/geography';
import * as schema from '../src/shared/infrastructure/db/schema';

const url = process.env.DATABASE_URL;

// Tabla temporal (por sesión) para probar el tipo geography sin tocar el esquema real.
const places = pgTable('it_places', {
  id: uuid('id').primaryKey().defaultRandom(),
  location: geographyPoint('location').notNull(),
});

describe.skipIf(!url)('base de datos (integración)', () => {
  const client = postgres(url ?? '', { max: 1, onnotice: () => {} });
  const db = drizzle({ client, schema });
  const email = `it-${crypto.randomUUID()}@panter.test`;

  beforeAll(async () => {
    await db.execute(
      sql`CREATE TEMP TABLE it_places (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), location geography(Point,4326) NOT NULL)`,
    );
  });

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.email, email));
    await client.end();
  });

  it('la extensión postgis está instalada', async () => {
    const rows = await db.execute<{ extname: string }>(
      sql`SELECT extname FROM pg_extension WHERE extname = 'postgis'`,
    );
    expect(rows.map((r) => r.extname)).toEqual(['postgis']);
  });

  it('inserta un usuario con rol y lo lee de vuelta', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email, fullName: 'Prueba Integración', phone: '+573001234567' })
      .returning();
    expect(user?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user?.status).toBe('ACTIVE');

    await db.insert(schema.userRoles).values([
      { userId: user!.id, role: Role.PASSENGER },
      { userId: user!.id, role: Role.DRIVER, grantedBy: user!.id },
    ]);

    const roles = await db
      .select({ role: schema.userRoles.role, grantedBy: schema.userRoles.grantedBy })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, user!.id))
      .orderBy(schema.userRoles.role);
    expect(roles).toEqual([
      { role: Role.PASSENGER, grantedBy: null },
      { role: Role.DRIVER, grantedBy: user!.id },
    ]);
  });

  it('el correo es único sin distinguir mayúsculas', async () => {
    await expect(db.insert(schema.users).values({ email: email.toUpperCase() })).rejects.toThrow();
  });

  it('el enum role rechaza valores fuera de @panter/contracts', async () => {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    await expect(
      db.execute(sql`INSERT INTO user_roles (user_id, role) VALUES (${user!.id}, 'SUPERUSER')`),
    ).rejects.toThrow();
  });

  it('escribe y lee un punto geography(Point,4326)', async () => {
    const point = { lng: -76.6167, lat: 1.0294 };
    const [inserted] = await db.insert(places).values({ location: point }).returning();
    expect(inserted?.location).toEqual(point);

    const [read] = await db.select().from(places).where(eq(places.id, inserted!.id));
    expect(read?.location).toEqual(point);

    const [check] = await db.execute<{ srid: number; geojson: string; meters: number }>(
      sql`SELECT ST_SRID(location::geometry) AS srid,
                 ST_AsGeoJSON(location) AS geojson,
                 ST_Distance(location, 'SRID=4326;POINT(-76.6167 1.0384)'::geography) AS meters
          FROM it_places WHERE id = ${inserted!.id}`,
    );
    expect(check?.srid).toBe(4326);
    expect(JSON.parse(check!.geojson)).toEqual({ type: 'Point', coordinates: [-76.6167, 1.0294] });
    // ~0,009° de latitud ≈ 1 km sobre el esferoide.
    expect(Number(check?.meters)).toBeGreaterThan(990);
    expect(Number(check?.meters)).toBeLessThan(1010);
  });
});
