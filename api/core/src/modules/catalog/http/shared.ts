import { z } from '@hono/zod-openapi';
import { Role } from '@panter/contracts';
import type { Context, MiddlewareHandler } from 'hono';
import type { AppBindings } from '../../../env';
import { ErrorSchema } from '../../../shared/http/schemas';
import { hasAnyRole } from '../../auth/domain/authorization';
import type { Viewer } from '../application/areas';

export const json = <T>(schema: T) => ({ 'application/json': { schema } });
export const error = (description: string) => ({ description, content: json(ErrorSchema) });
export const security = [{ bearerAuth: [] }];
export const openapiPath = (path: string) => path.replace(/:(\w+)/g, '{$1}');

export const IdParam = z.uuid().openapi({ param: { name: 'id', in: 'path' } });

/**
 * Las rutas públicas del catálogo aceptan un access token opcional: con uno de ADMIN se ven los
 * desactivados y quién editó. Con un token inválido o vencido responden 401 (el cliente debe
 * renovarlo), igual que las rutas protegidas.
 */
export function optionalAuth(
  requireAuth: () => MiddlewareHandler<AppBindings>,
): MiddlewareHandler<AppBindings> {
  const auth = requireAuth();
  return async (c, next) => (c.req.header('Authorization') ? auth(c, next) : next());
}

export function viewerOf(c: Context<AppBindings>): Viewer {
  const actor = c.get('actor');
  return { isAdmin: actor ? hasAnyRole(actor, [Role.ADMIN]) : false };
}

/**
 * `?includeInactive=false` debe ser false: `z.coerce.boolean()` del contrato convierte cualquier
 * texto no vacío en true. Aquí se acepta true/false/1/0 y `isTrue` lo pasa a booleano.
 */
export const BooleanQuery = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .openapi({ example: 'false' });

export const isTrue = (v: string | undefined) => v === 'true' || v === '1';

/** Público: lo puede guardar el navegador 60 s (igual que la caché del isolate). */
export const PUBLIC_CACHE = 'public, max-age=60';

export const HistoryQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
