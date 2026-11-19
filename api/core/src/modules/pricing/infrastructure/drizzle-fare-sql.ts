import { Role } from '@panter/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { rowsOf } from '../../../shared/infrastructure/db/rows';
import type { AnyPgDatabase } from '../../auth/infrastructure/drizzle-user-repository';

/** `actor_ok`: quien edita sigue siendo ADMIN con la cuenta ACTIVE (CTE común). */
export const actorIsAdminCte = (actorId: string) => sql`
  actor_ok AS (
    SELECT EXISTS (
      SELECT 1 FROM user_roles r JOIN users u ON u.id = r.user_id
      WHERE r.user_id = ${actorId}::uuid AND r.role = ${Role.ADMIN}::role AND u.status = 'ACTIVE'
    ) AS ok
  )`;

/** Fila resultado de una edición (ver `EditResult`). */
export interface EditRow {
  actorIsAdmin: boolean;
  exists: boolean;
  changed: number;
  polygonValid?: boolean;
  polygonReason?: string | null;
}

export async function runEdit(db: AnyPgDatabase, statement: SQL) {
  const row = rowsOf<EditRow>(await db.execute(statement))[0];
  return {
    actorIsAdmin: row?.actorIsAdmin === true,
    exists: row?.exists === true,
    changed: Number(row?.changed ?? 0) > 0,
    polygonValid: row?.polygonValid !== false,
    polygonReason: row?.polygonReason ?? null,
  };
}

/** Columna timestamptz en UTC con microsegundos (cursores estables). */
export const isoMicros = (column: SQL | unknown) =>
  sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
