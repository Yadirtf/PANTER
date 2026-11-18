import { ApiErrorCode } from '@panter/contracts';
import { LOGIN_PATH } from '@/features/navigation/role-home';
import { CONSENT_UPDATED_PARAM, consentErrorMessage } from './messages';

const SESSION_ENDED = new Set<string>([
  ApiErrorCode.UNAUTHENTICATED,
  ApiErrorCode.TOKEN_EXPIRED,
  ApiErrorCode.REFRESH_TOKEN_INVALID,
]);

export type ConsentFailureAction =
  { kind: 'navigate'; to: string } | { kind: 'message'; message: string };

/**
 * Qué hace /consentimiento si "Acepto" falla:
 * - CONSENT_VERSION_OUTDATED → recarga la página (con el aviso nuevo) y muestra por qué.
 * - Sesión terminada → al login.
 * - Otro error → mensaje en español.
 */
export function consentFailureAction(code: string, currentUrl: string): ConsentFailureAction {
  if (code === ApiErrorCode.CONSENT_VERSION_OUTDATED) {
    const url = new URL(currentUrl);
    url.searchParams.set(CONSENT_UPDATED_PARAM, '1');
    return { kind: 'navigate', to: url.toString() };
  }
  if (SESSION_ENDED.has(code)) return { kind: 'navigate', to: LOGIN_PATH };
  return { kind: 'message', message: consentErrorMessage(code) };
}
