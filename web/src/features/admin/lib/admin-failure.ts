import { ApiErrorCode } from '@panter/contracts';
import { requiresLogin } from '@/features/admin/lib/messages';
import { CONSENT_PATH, LOGIN_PATH } from '@/features/navigation/role-home';
import { toApiError } from '@/shared/api/errors';

/**
 * Manejo común de un fallo en una acción del panel: sesión terminada → login; falta el
 * consentimiento → aviso de privacidad; cualquier otro → mensaje en español con `messageFor`.
 */
export function handleAdminFailure(
  failure: unknown,
  returnTo: string,
  messageFor: (code: string) => string,
  setError: (message: string) => void,
): void {
  const code = toApiError(failure).code;
  if (requiresLogin(code)) {
    window.location.assign(`${LOGIN_PATH}?next=${encodeURIComponent(returnTo)}`);
    return;
  }
  if (code === ApiErrorCode.CONSENT_REQUIRED) {
    window.location.assign(`${CONSENT_PATH}?next=${encodeURIComponent(returnTo)}`);
    return;
  }
  setError(messageFor(code));
}
