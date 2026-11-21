import type { CatalogHistoryResponse } from '@panter/contracts';
import { decodeHistoryCursor, encodeHistoryCursor } from '../domain/history-cursor';
import { CatalogErrors } from './errors';
import type { CatalogChangeRepository, CatalogEntity } from './ports';

export interface CatalogHistoryQuery {
  cursor?: string;
  limit: number;
}

/** GET /admin/areas/:id/history y /admin/places/:id/history */
export type ListCatalogHistory = (
  entityId: string,
  query: CatalogHistoryQuery,
) => Promise<CatalogHistoryResponse>;

/**
 * Historial de un barrio, vereda o lugar, del más reciente al más antiguo, con autor y valores
 * antes y después. Cursor opaco (`nextCursor`); uno alterado → 400.
 */
export function makeListCatalogHistory(deps: {
  changes: CatalogChangeRepository;
  entity: CatalogEntity;
}): ListCatalogHistory {
  return async (entityId, { cursor, limit }) => {
    const after = cursor ? decodeHistoryCursor(cursor) : undefined;
    if (after === null) throw CatalogErrors.invalidCursor();
    const page = await deps.changes.list({ entity: deps.entity, entityId, limit, after });
    return { items: page.items, nextCursor: page.next ? encodeHistoryCursor(page.next) : null };
  };
}
