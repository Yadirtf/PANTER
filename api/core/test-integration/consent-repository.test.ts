// Repositorio de consentimiento (HU-109) contra PostgreSQL real. Requiere DATABASE_URL con las
// migraciones aplicadas; sin ella se omite.
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createDrizzleConsentRepository } from '../src/modules/consent/infrastructure/drizzle-consent-repository';
import * as schema from '../src/shared/infrastructure/db/schema';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('DrizzleConsentRepository (integración)', () => {
  const client = postgres(url ?? '', { max: 2, onnotice: () => {} });
  const db = drizzle({ client, schema });
  const repo = createDrizzleConsentRepository(db);
  const run = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];

  async function user(name: string) {
    const [row] = await db
      .insert(schema.users)
      .values({ email: `it-${run}-${name}@panter.test` })
      .returning();
    ids.push(row!.id);
    return row!;
  }

  afterAll(async () => {
    if (ids.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, ids));
    await client.end();
  });

  it('sin aceptaciones → null; acepta con IP y User-Agent', async () => {
    const u = await user('acepta');
    expect(await repo.latest(u.id)).toBeNull();
    const ok = await repo.accept({
      userId: u.id,
      version: 'v1',
      ip: '190.85.1.2',
      userAgent: 'PANTER-app/1.0',
    });
    expect(ok).toBe(true);
    const latest = await repo.latest(u.id);
    expect(latest?.version).toBe('v1');
    expect(latest?.acceptedAt).toMatch(/Z$/);
    const [row] = await db
      .select()
      .from(schema.userConsents)
      .where(eq(schema.userConsents.userId, u.id));
    expect(row).toMatchObject({ ip: '190.85.1.2', userAgent: 'PANTER-app/1.0' });
  });

  it('aceptar de nuevo la misma versión conserva la fecha; la versión nueva queda como última', async () => {
    const u = await user('dos-versiones');
    await repo.accept({ userId: u.id, version: 'v1', ip: null, userAgent: null });
    const first = await repo.latest(u.id);
    await repo.accept({ userId: u.id, version: 'v1', ip: '1.1.1.1', userAgent: null });
    expect(await repo.latest(u.id)).toEqual(first);
    await new Promise((r) => setTimeout(r, 5));
    await repo.accept({ userId: u.id, version: 'v2', ip: null, userAgent: null });
    expect((await repo.latest(u.id))?.version).toBe('v2');
    const rows = await db
      .select()
      .from(schema.userConsents)
      .where(eq(schema.userConsents.userId, u.id));
    expect(rows).toHaveLength(2);
  });

  it('cuenta inexistente → false, sin error de llave foránea', async () => {
    expect(
      await repo.accept({ userId: crypto.randomUUID(), version: 'v1', ip: null, userAgent: null }),
    ).toBe(false);
  });

  it('al borrar la cuenta se borran sus aceptaciones (ON DELETE CASCADE)', async () => {
    const u = await user('borrada');
    await repo.accept({ userId: u.id, version: 'v1', ip: null, userAgent: null });
    await db.delete(schema.users).where(eq(schema.users.id, u.id));
    expect(await repo.latest(u.id)).toBeNull();
  });
});
