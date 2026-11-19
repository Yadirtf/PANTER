import type { FareChange } from '@panter/contracts';
import { desc, eq, sql } from 'drizzle-orm';
import { parsePolygon } from '../../../shared/infrastructure/db/geography-polygon';
import { fareChanges, users } from '../../../shared/infrastructure/db/schema';
import type { AnyPgDatabase } from '../../auth/infrastructure/drizzle-user-repository';
import type { FareChangeRepository } from '../application/ports';
import { isoMicros } from './drizzle-fare-sql';

type Snapshot = Record<string, unknown>;

/**
 * El polígono se guarda en `fare_changes` como GeoJSON (`ST_AsGeoJSON`); la API lo devuelve en
 * el mismo formato de anillos `{ lat, lng }` que el resto de geocercas.
 */
function presentSnapshot(value: unknown): Snapshot | null {
  if (value === null || typeof value !== 'object') return null;
  const snapshot = { ...(value as Snapshot) };
  if (snapshot.polygon && typeof snapshot.polygon === 'object') {
    try {
      snapshot.polygon = parsePolygon(snapshot.polygon);
    } catch {
      // Un snapshot antiguo con otro formato se devuelve tal cual.
    }
  }
  return snapshot;
}

/** Historial de cambios de tarifas y geocercas (HU-403), del más reciente al más antiguo. */
export function createDrizzleFareChangeRepository(db: AnyPgDatabase): FareChangeRepository {
  return {
    async list({ limit, after }) {
      const rows = await db
        .select({
          id: fareChanges.id,
          entity: fareChanges.entity,
          entityKey: fareChanges.entityKey,
          before: fareChanges.before,
          after: fareChanges.after,
          changedBy: users.email,
          changedAt: fareChanges.changedAt,
          cursorAt: isoMicros(fareChanges.changedAt),
        })
        .from(fareChanges)
        .leftJoin(users, eq(users.id, fareChanges.changedBy))
        .where(
          after
            ? sql`(${fareChanges.changedAt}, ${fareChanges.id}) < (${after.changedAt}::timestamptz, ${after.id}::uuid)`
            : undefined,
        )
        .orderBy(desc(fareChanges.changedAt), desc(fareChanges.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const items: FareChange[] = page.map((r) => ({
        id: r.id,
        entity: r.entity,
        entityKey: r.entityKey,
        before: presentSnapshot(r.before),
        after: presentSnapshot(r.after),
        changedBy: r.changedBy,
        changedAt: r.changedAt.toISOString(),
      }));
      return {
        items,
        next: rows.length > limit && last ? { changedAt: last.cursorAt, id: last.id } : null,
      };
    },
  };
}
