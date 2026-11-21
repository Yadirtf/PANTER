import type { AreasResponse, Place, PlacesResponse } from '@panter/contracts';
import { loadFailure, loadWithSession, type ServerLoad } from '@/features/auth/server/server-load';
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

/** Lista de /admin/lugares (activos y desactivados), con Bearer. */
export function loadPlacesPage(
  api: CatalogApi,
  tokens: SessionTokensIn,
): Promise<ServerLoad<PlacesResponse>> {
  return loadWithSession(tokens, (token) => api.places(token, { includeInactive: true }));
}

export type PublicPlacesLoad = { kind: 'ok'; places: Place[] } | { kind: 'error'; code: string };

/**
 * Lugares del catálogo para los mapas de la web (/despacho, /admin/tarifas): GET /places es
 * público, sin token. Si falla, el mapa se muestra sin lugares y con un aviso.
 */
export async function loadPublicPlaces(api: CatalogApi): Promise<PublicPlacesLoad> {
  try {
    const { items } = await api.places(null);
    return { kind: 'ok', places: items };
  } catch (failure) {
    const result = loadFailure(failure);
    return { kind: 'error', code: result.kind === 'error' ? result.code : 'UNAUTHENTICATED' };
  }
}
