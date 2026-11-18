// Repositorio de roles de personal (HU-108) contra PostgreSQL real. Requiere DATABASE_URL con
// las migraciones aplicadas; sin ella se omite.
import { Role } from '@panter/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createDrizzleStaffRoleRepository,
  escapeLike,
} from '../src/modules/admin/infrastructure/drizzle-staff-role-repository';
import * as schema from '../src/shared/infrastructure/db/schema';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('DrizzleStaffRoleRepository (integración)', () => {
  const client = postgres(url ?? '', { max: 8, onnotice: () => {} });
  const db = drizzle({ client, schema });
  const repo = createDrizzleStaffRoleRepository(db);
  const run = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];

  async function user(
    name: string,
    options: { roles?: Role[]; status?: 'ACTIVE' | 'SUSPENDED'; createdAt?: string } = {},
  ) {
    const [row] = await db
      .insert(schema.users)
      .values({
        email: `it-${run}-${name}@panter.test`,
        status: options.status ?? 'ACTIVE',
        ...(options.createdAt ? { createdAt: sql`${options.createdAt}::timestamptz` } : {}),
      })
      .returning();
    ids.push(row!.id);
    const roles = options.roles ?? [Role.PASSENGER];
    if (roles.length > 0) {
      await db.insert(schema.userRoles).values(roles.map((role) => ({ userId: row!.id, role })));
    }
    return row!;
  }

  const audit = (userId: string) =>
    db
      .select({
        actorId: schema.roleAudit.actorId,
        role: schema.roleAudit.role,
        action: schema.roleAudit.action,
      })
      .from(schema.roleAudit)
      .where(eq(schema.roleAudit.userId, userId))
      .orderBy(schema.roleAudit.at);

  afterAll(async () => {
    if (ids.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, ids));
    await client.end();
  });

  it('otorga con granted_by, es idempotente y audita solo el cambio', async () => {
    const admin = await user('admin-1', { roles: [Role.PASSENGER, Role.ADMIN] });
    const target = await user('despacho-1');
    const input = { actorId: admin.id, userId: target.id, role: Role.DISPATCHER } as const;

    expect(await repo.grantRole(input)).toEqual({
      actorIsAdmin: true,
      userExists: true,
      changed: true,
    });
    expect(await repo.grantRole(input)).toMatchObject({ changed: false });

    const [row] = await db
      .select()
      .from(schema.userRoles)
      .where(
        and(eq(schema.userRoles.userId, target.id), eq(schema.userRoles.role, Role.DISPATCHER)),
      );
    expect(row?.grantedBy).toBe(admin.id);
    expect(await audit(target.id)).toEqual([
      { actorId: admin.id, role: Role.DISPATCHER, action: 'grant' },
    ]);

    const view = await repo.findUser(target.id);
    expect(view).toMatchObject({
      id: target.id,
      email: target.email,
      status: 'ACTIVE',
      fullName: null,
      roles: [
        { role: 'PASSENGER', grantedBy: null },
        { role: 'DISPATCHER', grantedBy: admin.email },
      ],
    });
    expect(view?.createdAt).toMatch(/Z$/);
    expect(view?.roles[1]?.grantedAt).toMatch(/Z$/);
  });

  it('retira, es idempotente y audita', async () => {
    const admin = await user('admin-2', { roles: [Role.ADMIN] });
    const target = await user('operador-2', { roles: [Role.PASSENGER, Role.TOUR_OPERATOR] });
    const input = { actorId: admin.id, userId: target.id, role: Role.TOUR_OPERATOR } as const;
    expect(await repo.revokeRole(input)).toMatchObject({ actorIsAdmin: true, changed: true });
    expect(await repo.revokeRole(input)).toMatchObject({ actorIsAdmin: true, changed: false });
    expect((await repo.findUser(target.id))?.roles.map((r) => r.role)).toEqual(['PASSENGER']);
    expect(await audit(target.id)).toEqual([
      { actorId: admin.id, role: Role.TOUR_OPERATOR, action: 'revoke' },
    ]);
  });

  it('actor sin ADMIN o suspendido: no cambia nada', async () => {
    const fake = await user('no-admin', { roles: [Role.PASSENGER, Role.DISPATCHER] });
    const suspended = await user('admin-suspendido', {
      roles: [Role.ADMIN],
      status: 'SUSPENDED',
    });
    const target = await user('objetivo-3');
    for (const actor of [fake, suspended]) {
      const input = { actorId: actor.id, userId: target.id, role: Role.ADMIN } as const;
      expect(await repo.grantRole(input)).toEqual({
        actorIsAdmin: false,
        userExists: true,
        changed: false,
      });
    }
    expect((await repo.findUser(target.id))?.roles.map((r) => r.role)).toEqual(['PASSENGER']);
    expect(await audit(target.id)).toEqual([]);
  });

  it('usuario inexistente → userExists false', async () => {
    const admin = await user('admin-4', { roles: [Role.ADMIN] });
    const missing = crypto.randomUUID();
    const input = { actorId: admin.id, userId: missing, role: Role.ADMIN } as const;
    expect(await repo.grantRole(input)).toEqual({
      actorIsAdmin: true,
      userExists: false,
      changed: false,
    });
    expect(await repo.revokeRole(input)).toMatchObject({ userExists: false, changed: false });
    expect(await repo.findUser(missing)).toBeNull();
  });

  it('dos administradores se retiran el ADMIN a la vez: siempre queda uno', async () => {
    for (let round = 0; round < 5; round++) {
      const a = await user(`mutuo-a-${round}`, { roles: [Role.ADMIN] });
      const b = await user(`mutuo-b-${round}`, { roles: [Role.ADMIN] });
      const results = await Promise.all([
        repo.revokeRole({ actorId: a.id, userId: b.id, role: Role.ADMIN }),
        repo.revokeRole({ actorId: b.id, userId: a.id, role: Role.ADMIN }),
      ]);
      expect(results.filter((r) => r.changed)).toHaveLength(1);
      expect(results.filter((r) => !r.actorIsAdmin)).toHaveLength(1);
      const admins = await db
        .select({ userId: schema.userRoles.userId })
        .from(schema.userRoles)
        .where(
          and(
            inArray(schema.userRoles.userId, [a.id, b.id]),
            eq(schema.userRoles.role, Role.ADMIN),
          ),
        );
      expect(admins).toHaveLength(1);
    }
  });

  it('lista por correo (parcial, sin mayúsculas) con cursor estable en el mismo instante', async () => {
    const at = '2026-11-18T12:00:00.123456Z';
    const tag = `lista-${run}`;
    // Cinco cuentas con el mismo created_at: el desempate es el id.
    for (let i = 0; i < 5; i++) await user(`${tag}-${i}`, { createdAt: at });
    await user(`${tag}-reciente`);

    const seen: string[] = [];
    let after;
    for (let page = 0; page < 10; page++) {
      const result = await repo.listUsers({ q: tag.toUpperCase(), limit: 2, after });
      seen.push(...result.items.map((u) => u.email));
      if (!result.next) break;
      after = result.next;
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    expect(seen[0]).toContain('reciente');
    expect(after?.createdAt).toBe(at);

    const all = await repo.listUsers({ q: tag, limit: 100 });
    expect(all.items).toHaveLength(6);
    expect(all.next).toBeNull();
    const ordered = all.items.slice(1).map((u) => u.id);
    expect(ordered).toEqual([...ordered].sort().reverse());
  });

  it('los comodines de LIKE en q se buscan literalmente', async () => {
    await user(`comodin_${run}`);
    await user(`comodinX${run}`);
    const result = await repo.listUsers({ q: `comodin_${run}`, limit: 10 });
    expect(result.items.map((u) => u.email)).toEqual([`it-${run}-comodin_${run}@panter.test`]);
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });

  it('sin q lista todo; usuario sin roles devuelve roles vacíos', async () => {
    const bare = await user('sin-roles', { roles: [] });
    const page = await repo.listUsers({ limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.next).not.toBeNull();
    expect((await repo.findUser(bare.id))?.roles).toEqual([]);
    expect(await repo.listUsers({ q: `nadie-${run}-xyz`, limit: 5 })).toEqual({
      items: [],
      next: null,
    });
  });
});
