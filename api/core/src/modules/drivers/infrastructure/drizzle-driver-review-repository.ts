import { DocumentStatus, DriverAvailability, Role } from '@panter/contracts';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { rowsOf } from '../../../shared/infrastructure/db/rows';
import { driverDocuments, driverProfiles, users } from '../../../shared/infrastructure/db/schema';
import type { AnyPgDatabase } from '../../auth/infrastructure/drizzle-user-repository';
import type { DecisionResult, DriverReviewRepository } from '../application/ports';
import type { AdminDriverRecord, DriverDocumentRecord } from '../domain/driver-profile';
import { toDocumentRecord, toProfileRecord } from './drizzle-driver-repository';

const reviewer = alias(users, 'reviewer');

/** `applied_at` en UTC con microsegundos, para un cursor que no pierde precisión. */
const appliedAtMicros = sql<string>`to_char(${driverProfiles.appliedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Arreglo de estados como literal de Postgres (`{PENDING,REJECTED}`), para `= ANY(...)`. */
const statusArray = (statuses: readonly string[]) =>
  sql`${`{${statuses.join(',')}}`}::driver_verification_status[]`;

/**
 * CTE común: ¿quien decide sigue siendo ADMIN con la cuenta ACTIVE? (la base de datos manda,
 * no el token; igual que HU-108).
 */
const actorOk = (actorId: string) => sql`
  actor_ok AS (
    SELECT EXISTS (
      SELECT 1 FROM users u JOIN user_roles r ON r.user_id = u.id
      WHERE u.id = ${actorId}::uuid AND u.status = 'ACTIVE' AND r.role = ${Role.ADMIN}::role
    ) AS ok
  )`;

interface DecisionRow {
  actorIsAdmin: boolean;
  changed: number;
}

/**
 * Repositorio de la revisión por ADMIN (HU-204) sobre driver_profiles, driver_documents, users,
 * user_roles y role_audit.
 *
 * Cada decisión es **una sola sentencia** (neon-http no tiene transacciones interactivas):
 * bloquea la fila del perfil con `FOR UPDATE` solo si sigue en un estado de origen permitido,
 * comprueba al actor y aplica el cambio. Dos administradores que deciden a la vez: el segundo
 * espera el bloqueo, ve el estado nuevo y no cambia nada (`changed: false`).
 */
export function createDrizzleDriverReviewRepository(db: AnyPgDatabase): DriverReviewRepository {
  async function documentsOf(ids: string[]): Promise<Map<string, DriverDocumentRecord[]>> {
    const byUser = new Map<string, DriverDocumentRecord[]>();
    if (ids.length === 0) return byUser;
    const rows = await db
      .select()
      .from(driverDocuments)
      .where(inArray(driverDocuments.userId, ids));
    for (const row of rows) {
      const list = byUser.get(row.userId) ?? [];
      list.push(toDocumentRecord(row));
      byUser.set(row.userId, list);
    }
    return byUser;
  }

  async function select(where: SQL | undefined, limit: number) {
    const rows = await db
      .select({
        profile: driverProfiles,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        reviewedByEmail: reviewer.email,
        cursorAt: appliedAtMicros,
      })
      .from(driverProfiles)
      .innerJoin(users, eq(users.id, driverProfiles.userId))
      .leftJoin(reviewer, eq(reviewer.id, driverProfiles.reviewedBy))
      .where(where)
      .orderBy(asc(driverProfiles.appliedAt), asc(driverProfiles.userId))
      .limit(limit);
    const docs = await documentsOf(rows.map((r) => r.profile.userId));
    return rows.map((r) => ({
      cursorAt: r.cursorAt,
      record: {
        profile: toProfileRecord(r.profile),
        documents: docs.get(r.profile.userId) ?? [],
        email: r.email,
        fullName: r.fullName,
        phone: r.phone,
        reviewedByEmail: r.reviewedByEmail,
      } satisfies AdminDriverRecord,
    }));
  }

  async function decide(statement: SQL): Promise<DecisionResult> {
    const row = rowsOf<DecisionRow>(await db.execute(statement))[0];
    return { actorIsAdmin: row?.actorIsAdmin === true, changed: Number(row?.changed ?? 0) > 0 };
  }

  return {
    async list({ status, limit, after }) {
      const conditions: SQL[] = [];
      if (status) conditions.push(eq(driverProfiles.verificationStatus, status));
      if (after) {
        conditions.push(
          sql`(${driverProfiles.appliedAt}, ${driverProfiles.userId}) > (${after.appliedAt}::timestamptz, ${after.userId}::uuid)`,
        );
      }
      const rows = await select(and(...conditions), limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((r) => r.record),
        next:
          rows.length > limit && last
            ? { appliedAt: last.cursorAt, userId: last.record.profile.userId }
            : null,
      };
    },

    async find(userId) {
      return (await select(eq(driverProfiles.userId, userId), 1))[0]?.record ?? null;
    },

    reviewDocument: ({ actorId, userId, type, status, reason, profileFrom }) =>
      decide(sql`
        WITH ${actorOk(actorId)},
        profile AS (
          SELECT user_id FROM driver_profiles
          WHERE user_id = ${userId}::uuid
            AND verification_status = ANY (${statusArray(profileFrom)})
          FOR UPDATE
        ),
        updated AS (
          UPDATE driver_documents d
          SET status = ${status}::document_status, rejection_reason = ${reason},
              reviewed_at = now(), reviewed_by = ${actorId}::uuid
          FROM profile p, actor_ok a
          WHERE d.user_id = p.user_id AND d.type = ${type}::document_type AND a.ok
          RETURNING d.user_id
        )
        SELECT (SELECT ok FROM actor_ok) AS "actorIsAdmin",
               (SELECT count(*) FROM updated)::int AS "changed"
      `),

    // Aprobar, otorgar DRIVER y auditar en la misma sentencia: o todo o nada.
    approve: ({ actorId, userId, from }) =>
      decide(sql`
        WITH ${actorOk(actorId)},
        profile AS (
          SELECT user_id FROM driver_profiles
          WHERE user_id = ${userId}::uuid AND verification_status = ANY (${statusArray(from)})
          FOR UPDATE
        ),
        docs AS (
          SELECT count(*)::int AS approved FROM driver_documents
          WHERE user_id = ${userId}::uuid AND status = ${DocumentStatus.APPROVED}::document_status
        ),
        updated AS (
          UPDATE driver_profiles dp
          SET verification_status = 'APPROVED', rejection_reason = NULL,
              reviewed_at = now(), reviewed_by = ${actorId}::uuid, updated_at = now()
          FROM profile p, actor_ok a, docs
          WHERE dp.user_id = p.user_id AND a.ok
            -- driver_documents tiene una fila por tipo y el enum tiene los 5 exigidos.
            AND docs.approved = (SELECT count(*) FROM unnest(enum_range(NULL::document_type)))
          RETURNING dp.user_id
        ),
        granted AS (
          INSERT INTO user_roles (user_id, role, granted_by)
          SELECT user_id, ${Role.DRIVER}::role, ${actorId}::uuid FROM updated
          ON CONFLICT (user_id, role) DO NOTHING
          RETURNING user_id, role
        ),
        audit AS (
          INSERT INTO role_audit (actor_id, user_id, role, action)
          SELECT ${actorId}::uuid, user_id, role, 'grant' FROM granted
        )
        SELECT (SELECT ok FROM actor_ok) AS "actorIsAdmin",
               (SELECT count(*) FROM updated)::int AS "changed"
      `),

    changeStatus: ({ actorId, userId, from, to, reason, setOffline }) =>
      decide(sql`
        WITH ${actorOk(actorId)},
        profile AS (
          SELECT user_id FROM driver_profiles
          WHERE user_id = ${userId}::uuid AND verification_status = ANY (${statusArray(from)})
          FOR UPDATE
        ),
        updated AS (
          UPDATE driver_profiles dp
          SET verification_status = ${to}::driver_verification_status,
              rejection_reason = ${reason},
              availability = CASE WHEN ${setOffline}
                THEN ${DriverAvailability.OFFLINE}::driver_availability ELSE dp.availability END,
              reviewed_at = now(), reviewed_by = ${actorId}::uuid, updated_at = now()
          FROM profile p, actor_ok a
          WHERE dp.user_id = p.user_id AND a.ok
          RETURNING dp.user_id
        )
        SELECT (SELECT ok FROM actor_ok) AS "actorIsAdmin",
               (SELECT count(*) FROM updated)::int AS "changed"
      `),
  };
}
