// Repositorio de cuentas (HU-101) contra PostgreSQL real. Requiere DATABASE_URL con las
// migraciones aplicadas; sin ella se omite (ver db.test.ts).
import { Role } from '@panter/contracts';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createDrizzleUserRepository } from '../src/modules/auth/infrastructure/drizzle-user-repository';
import * as schema from '../src/shared/infrastructure/db/schema';

const url = process.env.DATABASE_URL;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Envuelve el cliente para que cada SELECT del query builder se ejecute de inmediato pero
 * entregue su resultado `ms` más tarde. Sirve para forzar carreras de forma determinista.
 */
function delayedSelects<T extends object>(db: T, ms: number): T {
  const wrap = (builder: object): object =>
    new Proxy(builder, {
      get(target, prop) {
        const value = Reflect.get(target, prop) as unknown;
        if (prop === 'then') {
          const promise = (target as PromiseLike<unknown>).then(async (rows) => {
            await sleep(ms);
            return rows;
          });
          return promise.then.bind(promise);
        }
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(target, args);
          return result && typeof result === 'object' && 'then' in result ? wrap(result) : result;
        };
      },
    });
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== 'function') return value;
      if (prop !== 'select') return value.bind(target);
      return (...args: unknown[]) => wrap(value.apply(target, args) as object);
    },
  });
}

describe.skipIf(!url)('DrizzleUserRepository (integración)', () => {
  // Varias conexiones para que las carreras sean reales (INSERT simultáneos).
  const client = postgres(url ?? '', { max: 8, onnotice: () => {} });
  const db = drizzle({ client, schema });
  const repo = createDrizzleUserRepository(db);
  const run = crypto.randomUUID().slice(0, 8);
  const emails: string[] = [];
  const email = (name: string) => {
    const value = `it-${run}-${name}@panter.test`;
    emails.push(value);
    return value;
  };

  afterAll(async () => {
    if (emails.length > 0) {
      await db.delete(schema.users).where(
        inArray(
          sql`lower(${schema.users.email})`,
          emails.map((e) => e.toLowerCase()),
        ),
      );
    }
    await client.end();
  });

  it('crea la cuenta ACTIVE con rol PASSENGER (users + user_roles)', async () => {
    const e = email('nueva');
    const user = await repo.findOrCreatePassenger(e);
    expect(user).toMatchObject({
      email: e,
      status: 'ACTIVE',
      fullName: null,
      phone: null,
      roles: [Role.PASSENGER],
    });
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    const roles = await db
      .select({ role: schema.userRoles.role })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, user.id));
    expect(roles).toEqual([{ role: Role.PASSENGER }]);
  });

  it('es idempotente: la segunda vez devuelve la misma cuenta', async () => {
    const e = email('dos-veces');
    const a = await repo.findOrCreatePassenger(e);
    const b = await repo.findOrCreatePassenger(e);
    expect(b).toEqual(a);
  });

  it('encuentra la cuenta sin distinguir mayúsculas', async () => {
    const e = email('mayusculas');
    const [row] = await db.insert(schema.users).values({ email: e.toUpperCase() }).returning();
    await db.insert(schema.userRoles).values({ userId: row!.id, role: Role.PASSENGER });
    const user = await repo.findOrCreatePassenger(e);
    expect(user.id).toBe(row!.id);
  });

  it('carreras: 8 llamadas simultáneas crean una sola cuenta y un solo rol', async () => {
    const e = email('carrera');
    const results = await Promise.all(
      Array.from({ length: 8 }, () => repo.findOrCreatePassenger(e)),
    );
    expect(new Set(results.map((u) => u.id)).size).toBe(1);
    const rows = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${e}`);
    expect(rows).toHaveLength(1);
    const roles = await db
      .select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, rows[0]!.id));
    expect(roles).toHaveLength(1);
    for (const u of results) expect(u.roles).toEqual([Role.PASSENGER]);
  });

  it('carrera forzada: quien pierde el INSERT vuelve a buscar y recibe la misma cuenta', async () => {
    // Todas las búsquedas iniciales terminan (vacías) antes de cualquier INSERT: así 7 de las
    // 8 llamadas chocan con ON CONFLICT y toman el camino de "volver a buscar".
    const raced = createDrizzleUserRepository(delayedSelects(db, 150));
    const e = email('carrera-forzada');
    const results = await Promise.all(
      Array.from({ length: 8 }, () => raced.findOrCreatePassenger(e)),
    );
    expect(new Set(results.map((u) => u.id)).size).toBe(1);
    for (const u of results) expect(u.roles).toEqual([Role.PASSENGER]);
  });

  it('devuelve todos los roles y el estado de una cuenta existente', async () => {
    const e = email('conductora');
    const [row] = await db
      .insert(schema.users)
      .values({ email: e, fullName: 'Ana Conductora', status: 'SUSPENDED' })
      .returning();
    await db.insert(schema.userRoles).values([
      { userId: row!.id, role: Role.DRIVER },
      { userId: row!.id, role: Role.PASSENGER },
    ]);
    const user = await repo.findOrCreatePassenger(e);
    expect(user).toMatchObject({
      id: row!.id,
      fullName: 'Ana Conductora',
      status: 'SUSPENDED',
      roles: [Role.PASSENGER, Role.DRIVER],
    });
    expect(await repo.findById(row!.id)).toEqual(user);
  });

  it('a una cuenta sin roles le agrega PASSENGER', async () => {
    const e = email('sin-roles');
    const [row] = await db.insert(schema.users).values({ email: e }).returning();
    const user = await repo.findOrCreatePassenger(e);
    expect(user.roles).toEqual([Role.PASSENGER]);
    const roles = await db
      .select({ role: schema.userRoles.role })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, row!.id));
    expect(roles).toEqual([{ role: Role.PASSENGER }]);
  });

  it('findById devuelve null si no existe', async () => {
    expect(await repo.findById(crypto.randomUUID())).toBeNull();
  });
});
