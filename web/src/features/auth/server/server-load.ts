import { ApiErrorCode } from '@panter/contracts';
import { toApiError } from '@/shared/api/errors';
import { callWithSession, type SessionTokensIn } from './session-call';

/** Resultado de una carga autenticada desde un Server Component (mismo patrón que /admin/usuarios). */
export type ServerLoad<T> =
  | { kind: 'ok'; data: T }
  /** Token vencido o ausente: la página redirige a /api/session/refresh. */
  | { kind: 'renew' }
  /** La API exige aceptar el aviso de privacidad (HU-109): la página lleva a /consentimiento. */
  | { kind: 'consent' }
  | { kind: 'error'; code: string };

export function loadFailure(failure: unknown): Exclude<ServerLoad<never>, { kind: 'ok' }> {
  const code = toApiError(failure).code;
  if (code === ApiErrorCode.TOKEN_EXPIRED || code === ApiErrorCode.UNAUTHENTICATED) {
    return { kind: 'renew' };
  }
  if (code === ApiErrorCode.CONSENT_REQUIRED) return { kind: 'consent' };
  return { kind: 'error', code };
}

/**
 * Llama a la API con el access token de la cookie. No refresca aquí: un Server Component no
 * puede escribir cookies y un refresh sin guardar el par nuevo dejaría la cookie con un refresh
 * token ya rotado.
 */
export async function loadWithSession<T>(
  tokens: SessionTokensIn,
  call: (accessToken: string) => Promise<T>,
): Promise<ServerLoad<T>> {
  try {
    const { value } = await callWithSession(tokens, null, call);
    return { kind: 'ok', data: value };
  } catch (failure) {
    return loadFailure(failure);
  }
}
