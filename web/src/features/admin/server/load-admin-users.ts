import { ApiErrorCode, type AdminUsersResponse } from '@panter/contracts';
import { callWithSession, type SessionTokensIn } from '@/features/auth/server/session-call';
import { toApiError } from '@/shared/api/errors';
import type { AdminApi } from './admin-api';

export type AdminUsersLoad =
  | { kind: 'ok'; data: AdminUsersResponse }
  /** Token vencido o ausente: la página redirige a /api/session/refresh. */
  | { kind: 'renew' }
  | { kind: 'error'; code: string };

/**
 * Primera página de /admin/usuarios desde un Server Component. No refresca aquí: un Server
 * Component no puede escribir cookies y un refresh sin guardar el par nuevo dejaría la cookie
 * con un refresh token ya rotado.
 */
export async function loadAdminUsers(
  admin: AdminApi,
  tokens: SessionTokensIn,
  q: string,
): Promise<AdminUsersLoad> {
  try {
    const { value } = await callWithSession(tokens, null, (token) =>
      admin.listUsers(token, { q: q || undefined }),
    );
    return { kind: 'ok', data: value };
  } catch (failure) {
    const code = toApiError(failure).code;
    if (code === ApiErrorCode.TOKEN_EXPIRED || code === ApiErrorCode.UNAUTHENTICATED) {
      return { kind: 'renew' };
    }
    return { kind: 'error', code };
  }
}
