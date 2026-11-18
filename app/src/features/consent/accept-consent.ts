// Lógica de "Aceptar y continuar" del aviso de privacidad (HU-109), sin React para probarla en
// Node. La pantalla solo traduce el resultado a mensajes.
import { ApiErrorCode, PRIVACY_POLICY_VERSION } from '@panter/contracts';
import { errorMessage } from '../../shared/api/error-messages';
import { ClientErrorCode, isApiError } from '../../shared/api/errors';
import type { SessionManager } from '../auth/session/session-manager';
import type { ConsentApi } from './api/consent-api';

export type AcceptConsentResult =
  /** Aceptado: la sesión ya no pide consentimiento y la navegación sigue sola. */
  | { readonly outcome: 'accepted' }
  /** El aviso cambió mientras se leía: se refrescó GET /me y hay que leerlo y aceptarlo de nuevo. */
  | { readonly outcome: 'outdated' }
  /** La API exige una versión que esta app no trae: hay que actualizar la app. */
  | { readonly outcome: 'appOutdated' };

export interface AcceptConsentDeps {
  api: ConsentApi;
  session: Pick<SessionManager, 'applyConsent' | 'refreshProfile' | 'getState'>;
  /** Versión del aviso que se mostró (la del texto que trae la app). */
  version?: string;
}

/**
 * POST /me/consent con `{ version, accepted: true }` y actualiza la sesión con el ConsentStatus
 * devuelto. Ante CONSENT_VERSION_OUTDATED refresca GET /me para volver a mostrar el aviso. Los
 * demás errores (sin red, sesión vencida…) se lanzan como `ApiError` sin tocar la sesión.
 */
export async function acceptConsent({
  api,
  session,
  version = PRIVACY_POLICY_VERSION,
}: AcceptConsentDeps): Promise<AcceptConsentResult> {
  try {
    const status = await api.accept({ version, accepted: true });
    await session.applyConsent(status);
    if (!status.required) return { outcome: 'accepted' };
  } catch (error) {
    if (!isApiError(error) || error.code !== ApiErrorCode.CONSENT_VERSION_OUTDATED) throw error;
    await session.refreshProfile();
  }
  // Sigue pendiente: si la versión vigente no es la del texto de la app, no hay forma de
  // aceptarla desde esta versión.
  const current = session.getState().user?.consent?.currentVersion;
  return current !== undefined && current !== version
    ? { outcome: 'appOutdated' }
    : { outcome: 'outdated' };
}

/** Mensaje para la pantalla cuando el aviso sigue pendiente; null si se aceptó. */
export function outcomeMessage(result: AcceptConsentResult): string | null {
  switch (result.outcome) {
    case 'accepted':
      return null;
    case 'outdated':
      return errorMessage({ code: ApiErrorCode.CONSENT_VERSION_OUTDATED });
    case 'appOutdated':
      return errorMessage({ code: ClientErrorCode.CONSENT_APP_OUTDATED });
  }
}
