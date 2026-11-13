import type { Context, MiddlewareHandler } from 'hono';
import type { AppBindings, Env } from '../../../env';
import { AuthErrors } from '../application/errors';
import type { AccessTokenVerifier } from '../application/ports';
import type { Actor } from '../domain/actor';

/** `Authorization: Bearer <token>` (esquema sin distinguir mayúsculas). */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

/**
 * Middleware de autenticación: valida el access token del header `Authorization` y deja el
 * actor en el contexto (`c.get('actor')`).
 * - Sin token, mal formado, firma, emisor o audiencia inválidos → 401 `UNAUTHENTICATED`.
 * - Token vencido → 401 `TOKEN_EXPIRED` (el cliente debe usar POST /auth/refresh).
 *
 * Uso (HU-104): `router.use('/me/*', requireAuth())` con la versión ya armada de
 * `composition/auth.ts`.
 */
export function makeRequireAuth(
  buildVerifier: (env: Env) => AccessTokenVerifier,
): () => MiddlewareHandler<AppBindings> {
  return () => async (c, next) => {
    const token = bearerToken(c.req.header('Authorization'));
    if (!token) throw AuthErrors.unauthenticated();
    const check = await buildVerifier(c.env).verify(token);
    if (!check.ok) {
      throw check.reason === 'expired' ? AuthErrors.tokenExpired() : AuthErrors.unauthenticated();
    }
    c.set('actor', check.actor);
    await next();
  };
}

/** Actor autenticado de la petición. Lanza `UNAUTHENTICATED` si la ruta no pasó por `requireAuth`. */
export function getActor(c: Context<AppBindings>): Actor {
  const actor = c.get('actor');
  if (!actor) throw AuthErrors.unauthenticated();
  return actor;
}
