import { Role, type AdminUser, type RoleGrant, type UserStatus } from '@panter/contracts';
import { and, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { rowsOf } from '../../../shared/infrastructure/db/rows';
import { userRoles, users } from '../../../shared/infrastructure/db/schema';
import type { AnyPgDatabase } from '../../auth/infrastructure/drizzle-user-repository';
import type { RoleChangeInput, RoleChangeResult, StaffRoleRepository } from '../application/ports';

/** Escapa los comodines de LIKE (`\` es el carácter de escape por defecto en PostgreSQL). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const granter = alias(users, 'granter');

/** `created_at` en UTC con microsegundos, para un cursor que no pierde precisión. */
const createdAtMicros = sql<string>`to_char(${users.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

interface ChangeRow {
  actorIsAdmin: boolean;
  userExists: boolean;
  changed: number;
}

/**
 * Repositorio de la gestión de roles de personal (HU-108) sobre `users`, `user_roles` y
 * `role_audit`.
 *
 * Otorgar y retirar son **una sola sentencia** (neon-http no tiene transacciones interactivas):
 * 1. bloquea con `FOR UPDATE` las filas ADMIN del actor y del destino, en orden de id (sin
 *    interbloqueos entre dos administradores que actúan a la vez);
 * 2. comprueba que el actor sigue siendo ADMIN con la cuenta ACTIVE;
 * 3. inserta o borra el rol (idempotente) y, solo si cambió, escribe en `role_audit`.
 *
 * Si dos administradores se retiran el ADMIN el uno al otro al mismo tiempo, el segundo espera
 * el bloqueo, ve que ya no es ADMIN y no borra nada (403): nunca quedan cero administradores.
 */
export function createDrizzleStaffRoleRepository(db: AnyPgDatabase): StaffRoleRepository {
  async function rolesOf(ids: string[]): Promise<Map<string, RoleGrant[]>> {
    const byUser = new Map<string, RoleGrant[]>();
    if (ids.length === 0) return byUser;
    const rows = await db
      .select({
        userId: userRoles.userId,
        role: userRoles.role,
        grantedAt: userRoles.grantedAt,
        grantedBy: granter.email,
      })
      .from(userRoles)
      .leftJoin(granter, eq(granter.id, userRoles.grantedBy))
      .where(inArray(userRoles.userId, ids));
    for (const row of rows) {
      const list = byUser.get(row.userId) ?? [];
      list.push({
        role: row.role,
        grantedAt: row.grantedAt.toISOString(),
        grantedBy: row.grantedBy,
      });
      byUser.set(row.userId, list);
    }
    const order: string[] = Object.values(Role);
    for (const list of byUser.values()) {
      list.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
    }
    return byUser;
  }

  async function selectUsers(where: SQL | undefined, limit: number) {
    return db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        status: users.status,
        createdAt: users.createdAt,
        cursorAt: createdAtMicros,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(limit);
  }

  async function withRoles(
    rows: {
      id: string;
      email: string;
      fullName: string | null;
      status: UserStatus;
      createdAt: Date;
    }[],
  ): Promise<AdminUser[]> {
    const roles = await rolesOf(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.fullName,
      status: r.status,
      roles: roles.get(r.id) ?? [],
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async function change(statement: SQL): Promise<RoleChangeResult> {
    const row = rowsOf<ChangeRow>(await db.execute(statement))[0];
    return {
      actorIsAdmin: row?.actorIsAdmin === true,
      userExists: row?.userExists === true,
      changed: Number(row?.changed ?? 0) > 0,
    };
  }

  /** CTE común: bloquea las filas ADMIN del actor y del destino y comprueba al actor. */
  const lockAndCheck = ({ actorId, userId }: RoleChangeInput) => sql`
    admins AS (
      SELECT user_id FROM user_roles
      WHERE role = ${Role.ADMIN}::role AND user_id IN (${actorId}::uuid, ${userId}::uuid)
      ORDER BY user_id
      FOR UPDATE
    ),
    locked AS (SELECT array_agg(user_id) AS ids FROM admins),
    actor_ok AS (
      SELECT EXISTS (
        SELECT 1 FROM users u, locked l
        WHERE u.id = ${actorId}::uuid AND u.status = 'ACTIVE' AND u.id = ANY (l.ids)
      ) AS ok
    ),
    target AS (SELECT id FROM users WHERE id = ${userId}::uuid)`;

  return {
    async listUsers({ q, limit, after }) {
      const conditions: SQL[] = [];
      if (q) conditions.push(ilike(users.email, `%${escapeLike(q)}%`));
      if (after) {
        conditions.push(
          sql`(${users.createdAt}, ${users.id}) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`,
        );
      }
      const rows = await selectUsers(and(...conditions), limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: await withRoles(page),
        next: rows.length > limit && last ? { createdAt: last.cursorAt, id: last.id } : null,
      };
    },

    async findUser(id) {
      const rows = await selectUsers(eq(users.id, id), 1);
      return (await withRoles(rows))[0] ?? null;
    },

    grantRole: (input) =>
      change(sql`
        WITH ${lockAndCheck(input)},
        inserted AS (
          INSERT INTO user_roles (user_id, role, granted_by)
          SELECT t.id, ${input.role}::role, ${input.actorId}::uuid
          FROM target t, actor_ok a WHERE a.ok
          ON CONFLICT (user_id, role) DO NOTHING
          RETURNING user_id, role
        ),
        audit AS (
          INSERT INTO role_audit (actor_id, user_id, role, action)
          SELECT ${input.actorId}::uuid, user_id, role, 'grant' FROM inserted
        )
        SELECT (SELECT ok FROM actor_ok) AS "actorIsAdmin",
               EXISTS (SELECT 1 FROM target) AS "userExists",
               (SELECT count(*) FROM inserted)::int AS "changed"
      `),

    revokeRole: (input) =>
      change(sql`
        WITH ${lockAndCheck(input)},
        deleted AS (
          DELETE FROM user_roles
          WHERE user_id = ${input.userId}::uuid AND role = ${input.role}::role
            AND (SELECT ok FROM actor_ok)
          RETURNING user_id, role
        ),
        audit AS (
          INSERT INTO role_audit (actor_id, user_id, role, action)
          SELECT ${input.actorId}::uuid, user_id, role, 'revoke' FROM deleted
        )
        SELECT (SELECT ok FROM actor_ok) AS "actorIsAdmin",
               EXISTS (SELECT 1 FROM target) AS "userExists",
               (SELECT count(*) FROM deleted)::int AS "changed"
      `),
  };
}
