import type { AreasResponse } from '@panter/contracts';
import { loadWithSession, type ServerLoad } from '@/features/auth/server/server-load';
import type { SessionTokensIn } from '@/features/auth/server/session-call';
import type { CatalogApi } from './catalog-api';

/**
 * Lista de /admin/barrios (activos y desactivados). Los polígonos se piden después desde el
 * navegador, por lotes, a /api/admin/areas/details (ver AREA_DETAILS_MAX_IDS).
 */
export function loadAreasPage(
  api: CatalogApi,
  tokens: SessionTokensIn,
): Promise<ServerLoad<AreasResponse>> {
  return loadWithSession(tokens, (token) => api.areas(token, { includeInactive: true }));
}
