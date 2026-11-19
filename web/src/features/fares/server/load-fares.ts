import type { FareConfigResponse } from '@panter/contracts';
import { loadWithSession, type ServerLoad } from '@/features/auth/server/server-load';
import type { SessionTokensIn } from '@/features/auth/server/session-call';
import type { FareHistoryResponse, FaresApi } from './fares-api';

export interface FaresPageLoad {
  config: ServerLoad<FareConfigResponse>;
  history: ServerLoad<FareHistoryResponse>;
}

/** Configuración y primera página del historial de /admin/tarifas, en paralelo. */
export async function loadFaresPage(
  api: FaresApi,
  tokens: SessionTokensIn,
): Promise<FaresPageLoad> {
  const [config, history] = await Promise.all([
    loadWithSession(tokens, (token) => api.config(token)),
    loadWithSession(tokens, (token) => api.history(token)),
  ]);
  return { config, history };
}

/** ¿Hay que renovar la sesión o aceptar el aviso antes de mostrar la página? */
export function faresRedirect(load: FaresPageLoad): 'renew' | 'consent' | null {
  const kinds = [load.config.kind, load.history.kind];
  if (kinds.includes('renew')) return 'renew';
  if (kinds.includes('consent')) return 'consent';
  return null;
}
