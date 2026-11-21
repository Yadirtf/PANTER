import type { CatalogChange } from '@panter/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import { catalogChanges, users } from '../../../shared/infrastructure/db/schema';
import type { AnyPgDatabase } from '../../auth/infrastructure/drizzle-user-repository';
import type { CatalogChangeRepository } from '../application/ports';
import { isoMicros, presentSnapshot } from './drizzle-catalog-sql';

/**
 * Historial de un barrio, vereda o lugar (`catalog_changes`), del más reciente al más antiguo,
 * con el correo de quien editó. Usa el índice (entity, entity_id, changed_at, id).
 */
export function createDrizzleCatalogChangeRepository(db: AnyPgDatabase): CatalogChangeRepository {
  return {
    async list({ entity, entityId, limit, after }) {
      const rows = await db
        .select({
          id: catalogChanges.id,
          entity: catalogChanges.entity,
          entityId: catalogChanges.entityId,
          action: catalogChanges.action,
          before: catalogChanges.before,
          after: catalogChanges.after,
          changedBy: users.email,
          changedAt: catalogChanges.changedAt,
          cursorAt: isoMicros(catalogChanges.changedAt),
        })
        .from(catalogChanges)
        .leftJoin(users, eq(users.id, catalogChanges.changedBy))
        .where(
          and(
            eq(catalogChanges.entity, entity),
            eq(catalogChanges.entityId, entityId),
            after
              ? sql`(${catalogChanges.changedAt}, ${catalogChanges.id}) < (${after.changedAt}::timestamptz, ${after.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(catalogChanges.changedAt), desc(catalogChanges.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const items: CatalogChange[] = page.map((r) => ({
        id: r.id,
        entity: r.entity,
        entityId: r.entityId,
        action: r.action,
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
