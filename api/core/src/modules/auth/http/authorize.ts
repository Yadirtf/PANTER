import type { ActiveMode, Role } from '@panter/contracts';
import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from '../../../env';
import { AuthErrors } from '../application/errors';
import { hasAnyRole, isInMode } from '../domain/authorization';
import { getActor } from './require-auth';

/**
 * Autorización por rol (§5.3, HU-104). Va siempre después de `requireAuth()`:
 *
 *   router.use('/admin/*', requireAuth(), requireRole('ADMIN'))
 *
 * - Sin actor (la ruta no pasó por `requireAuth`) → 401 `UNAUTHENTICATED`.
 * - Sin ninguno de los roles pedidos → 403 `FORBIDDEN`.
 *
 * Decide con los roles del access token, que pueden tener hasta 15 min de antigüedad: un rol
 * retirado deja de valer como máximo al vencer el token. Los casos de uso sensibles (p. ej.
 * otorgar o retirar roles, HU-108) vuelven a comprobar en la base de datos.
 */
export function requireRole(...roles: [Role, ...Role[]]): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (!hasAnyRole(getActor(c), roles)) throw AuthErrors.forbidden();
    await next();
  };
}

/**
 * Autorización por modo activo (§5.3, HU-104), después de `requireAuth()`:
 *
 *   router.use('/driver/*', requireAuth(), requireMode('driver'))
 *
 * Si el `activeMode` del access token no es el pedido → 403 `MODE_NOT_ALLOWED`. El modo
 * `driver` solo se obtiene con el rol DRIVER (POST /me/mode), así que no hace falta pedir
 * también `requireRole('DRIVER')`.
 */
export function requireMode(mode: ActiveMode): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (!isInMode(getActor(c), mode)) throw AuthErrors.modeNotAllowed();
    await next();
  };
}
