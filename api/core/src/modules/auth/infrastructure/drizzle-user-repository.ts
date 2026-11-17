import { Role, type UserStatus } from '@panter/contracts';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { rowsOf } from '../../../shared/infrastructure/db/rows';
import { userRoles, users } from '../../../shared/infrastructure/db/schema';
import { sortRoles, type User } from '../domain/user';
import type { UserRepository } from '../application/ports';

/** Cualquier cliente Drizzle de Postgres: neon-http en el Worker, postgres-js en integración. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPgDatabase = PgDatabase<PgQueryResultHKT, any>;

interface UserRow {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  status: UserStatus;
}

/**
 * Repositorio de cuentas sobre `users` y `user_roles` (migración 0001).
 *
 * `findOrCreatePassenger` primero busca; si no existe, crea usuario y rol PASSENGER en **una sola
 * sentencia** (CTE con dos INSERT, atómica sin transacción interactiva, que neon-http no admite).
 * `ON CONFLICT (lower(email)) DO NOTHING` la hace idempotente ante carreras: si otra petición
 * creó la cuenta entre la búsqueda y el INSERT, no se inserta nada y se vuelve a buscar.
 */
export function createDrizzleUserRepository(db: AnyPgDatabase): UserRepository {
  async function findWhere(where: SQL): Promise<User | null> {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        status: users.status,
        role: userRoles.role,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .where(where);
    const first = rows[0];
    if (!first) return null;
    const roles = rows.map((r) => r.role).filter((r): r is Role => r !== null);
    return {
      id: first.id,
      email: first.email,
      fullName: first.fullName,
      phone: first.phone,
      status: first.status,
      roles: sortRoles(roles),
    };
  }

  const findByEmail = (email: string) => findWhere(sql`lower(${users.email}) = lower(${email})`);

  async function insertPassenger(email: string): Promise<User | null> {
    const result = await db.execute(sql`
      WITH new_user AS (
        INSERT INTO users (email) VALUES (${email})
        ON CONFLICT ((lower(email))) DO NOTHING
        RETURNING id, email, full_name, phone, status
      ), new_role AS (
        INSERT INTO user_roles (user_id, role)
        SELECT id, ${Role.PASSENGER}::role FROM new_user
        ON CONFLICT DO NOTHING
      )
      SELECT id, email, full_name AS "fullName", phone, status FROM new_user
    `);
    const row = rowsOf<UserRow>(result)[0];
    return row ? { ...row, roles: [Role.PASSENGER] } : null;
  }

  /** Toda cuenta tiene PASSENGER (§5.3); repara cuentas creadas a mano sin roles. */
  async function ensurePassengerRole(user: User): Promise<User> {
    if (user.roles.length > 0) return user;
    await db
      .insert(userRoles)
      .values({ userId: user.id, role: Role.PASSENGER })
      .onConflictDoNothing();
    return { ...user, roles: [Role.PASSENGER] };
  }

  return {
    async findOrCreatePassenger(email) {
      const existing = await findByEmail(email);
      if (existing) return ensurePassengerRole(existing);
      const created = await insertPassenger(email);
      if (created) return created;
      const raced = await findByEmail(email);
      if (!raced) throw new Error('No se pudo crear ni encontrar la cuenta');
      return ensurePassengerRole(raced);
    },
    findById: (id) => findWhere(eq(users.id, id)),
  };
}
