import { desc, eq, sql } from 'drizzle-orm';
import { rowsOf } from '../../../shared/infrastructure/db/rows';
import { userConsents } from '../../../shared/infrastructure/db/schema';
import type { AnyPgDatabase } from '../../auth/infrastructure/drizzle-user-repository';
import type { ConsentRepository } from '../application/ports';

/** Repositorio de aceptaciones del aviso de privacidad sobre `user_consents` (migración 0003). */
export function createDrizzleConsentRepository(db: AnyPgDatabase): ConsentRepository {
  return {
    async latest(userId) {
      const [row] = await db
        .select({ version: userConsents.version, acceptedAt: userConsents.acceptedAt })
        .from(userConsents)
        .where(eq(userConsents.userId, userId))
        .orderBy(desc(userConsents.acceptedAt))
        .limit(1);
      return row ? { version: row.version, acceptedAt: row.acceptedAt.toISOString() } : null;
    },

    // Una sola sentencia: inserta solo si la cuenta existe (sin error de llave foránea) y
    // `ON CONFLICT DO NOTHING` conserva la primera aceptación de esa versión.
    async accept({ userId, version, ip, userAgent }) {
      const result = await db.execute(sql`
        WITH target AS (SELECT id FROM users WHERE id = ${userId}::uuid),
        inserted AS (
          INSERT INTO user_consents (user_id, version, ip, user_agent)
          SELECT id, ${version}, ${ip}, ${userAgent} FROM target
          ON CONFLICT (user_id, version) DO NOTHING
        )
        SELECT EXISTS (SELECT 1 FROM target) AS "userExists"
      `);
      return rowsOf<{ userExists: boolean }>(result)[0]?.userExists === true;
    },
  };
}
