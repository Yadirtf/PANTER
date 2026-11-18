import type {
  AdminDriver,
  AdminDriversResponse,
  DocumentType,
  DocumentViewUrlResponse,
} from '@panter/contracts';
import { loadWithSession, type ServerLoad } from '@/features/auth/server/server-load';
import type { SessionTokensIn } from '@/features/auth/server/session-call';
import { statusForApi, type DriversFilter } from '../lib/drivers';
import type { DriversApi } from './drivers-api';

export type DriversListLoad = ServerLoad<AdminDriversResponse>;

/** Primera página de /admin/conductores con el filtro de estado (PENDING por defecto). */
export function loadDrivers(
  api: DriversApi,
  tokens: SessionTokensIn,
  filter: DriversFilter,
): Promise<DriversListLoad> {
  return loadWithSession(tokens, (token) => api.list(token, { status: statusForApi(filter) }));
}

/** Tamaño de página para contar pendientes en el panel /admin (si hay más, se muestra "100+"). */
export const PENDING_COUNT_LIMIT = 100;

/** Pendientes para el enlace del panel. `null` si no se pudo obtener: el enlace sale sin número. */
export async function loadPendingCount(
  api: DriversApi,
  tokens: SessionTokensIn,
): Promise<AdminDriversResponse | null> {
  const load = await loadWithSession(tokens, (token) =>
    api.list(token, { status: 'PENDING', limit: PENDING_COUNT_LIMIT }),
  );
  return load.kind === 'ok' ? load.data : null;
}

/** URL firmada de lectura por documento subido; `null` si no se pudo pedir. */
export type ViewUrls = Partial<Record<DocumentType, DocumentViewUrlResponse | null>>;

export interface DriverDetailData {
  driver: AdminDriver;
  viewUrls: ViewUrls;
}

export type DriverDetailLoad = ServerLoad<DriverDetailData>;

/**
 * Detalle de /admin/conductores/[userId]. Las URLs firmadas de lectura se piden en el servidor
 * en el momento del render (vencen en DOCUMENT_URL_TTL_SECONDS), una por documento subido.
 */
export function loadDriverDetail(
  api: DriversApi,
  tokens: SessionTokensIn,
  userId: string,
): Promise<DriverDetailLoad> {
  return loadWithSession(tokens, async (token) => {
    const driver = await api.detail(token, userId);
    const entries = await Promise.all(
      driver.documents.map(async (doc) => {
        try {
          return [doc.type, await api.viewUrl(token, userId, doc.type)] as const;
        } catch {
          // Una URL que falla no impide revisar el resto: la tarjeta ofrece reintentar.
          return [doc.type, null] as const;
        }
      }),
    );
    return { driver, viewUrls: Object.fromEntries(entries) as ViewUrls };
  });
}
