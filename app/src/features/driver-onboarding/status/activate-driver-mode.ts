// "Pasar a modo conductor" tras la aprobación (HU-205). Primero GET /me para que la sesión tenga
// el rol DRIVER recién otorgado y después POST /me/mode, que emite tokens con el modo conductor.
// Con eso el layout raíz pasa solo al grupo (driver).
import { ActiveMode, Role } from '@panter/contracts';
import { errorMessage } from '../../../shared/api/error-messages';
import { toApiError } from '../../../shared/api/errors';
import type { SessionManager } from '../../auth/session/session-manager';

export type ActivateDriverModeResult =
  | { readonly outcome: 'switched' }
  /** GET /me aún no trae el rol (p. ej. sin red al refrescar): se puede reintentar. */
  | { readonly outcome: 'roleMissing'; readonly message: string }
  | { readonly outcome: 'error'; readonly message: string };

export const ROLE_MISSING_MESSAGE =
  'Aún no vemos tu aprobación en tu cuenta. Revisa tu conexión e intenta de nuevo en un momento.';

export async function activateDriverMode(
  session: Pick<SessionManager, 'refreshProfile' | 'switchMode' | 'getState'>,
): Promise<ActivateDriverModeResult> {
  await session.refreshProfile();
  const { user } = session.getState();
  if (!user?.roles.includes(Role.DRIVER)) {
    return { outcome: 'roleMissing', message: ROLE_MISSING_MESSAGE };
  }
  try {
    await session.switchMode(ActiveMode.DRIVER);
    return { outcome: 'switched' };
  } catch (error) {
    return { outcome: 'error', message: errorMessage(toApiError(error)) };
  }
}
