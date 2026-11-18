import { createRoute, z } from '@hono/zod-openapi';
import {
  AdminRoutes,
  AdminUserSchema,
  AdminUsersQuerySchema,
  AdminUsersResponseSchema,
  Role,
  RoleSchema,
} from '@panter/contracts';
import type { MiddlewareHandler } from 'hono';
import type { AppBindings, Env } from '../../../env';
import { createRouter } from '../../../shared/http/create-app';
import { ErrorSchema } from '../../../shared/http/schemas';
import { requireRole } from '../../auth/http/authorize';
import { getActor } from '../../auth/http/require-auth';
import type { ChangeRole, ListUsers } from '../application/staff-roles';

/** Fábricas de los casos de uso de administración (raíz de composición). */
export interface AdminFactories {
  listUsers: (env: Env) => ListUsers;
  grantRole: (env: Env) => ChangeRole;
  revokeRole: (env: Env) => ChangeRole;
}

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });
const security = [{ bearerAuth: [] }];

/** `:userId` de AdminRoutes en formato OpenAPI (`{userId}`). */
const openapiPath = (path: string) => path.replace(/:(\w+)/g, '{$1}');

const UserIdParam = z.uuid().openapi({ param: { name: 'userId', in: 'path' } });
// Se acepta cualquier rol del enum (no solo los de personal) para responder ROLE_NOT_GRANTABLE
// en lugar de un VALIDATION_ERROR genérico. Los clientes usan GrantStaffRoleBodySchema.
const RoleParam = z.enum(Role).openapi({ param: { name: 'role', in: 'path' } });
const GrantBodySchema = z.object({ role: RoleSchema });

const commonErrors = {
  401: error('UNAUTHENTICATED o TOKEN_EXPIRED'),
  403: error('FORBIDDEN: se necesita el rol ADMIN'),
};

/**
 * Gestión de usuarios y roles de personal (HU-108). Solo ADMIN: `requireAuth()` +
 * `requireRole('ADMIN')` en cada ruta, y otorgar o retirar vuelve a comprobar en la base de
 * datos que el actor sigue siendo ADMIN.
 */
export function adminRoutes(
  build: AdminFactories,
  requireAuth: () => MiddlewareHandler<AppBindings>,
) {
  const guard = (): MiddlewareHandler<AppBindings>[] => [requireAuth(), requireRole(Role.ADMIN)];

  const listRoute = createRoute({
    method: 'get',
    path: AdminRoutes.USERS,
    tags: ['admin'],
    summary: 'Buscar usuarios',
    description:
      'Búsqueda por correo (q: parte del correo, sin distinguir mayúsculas) con paginación por ' +
      'cursor opaco, del más reciente al más antiguo. Pasa `nextCursor` como `cursor` para la ' +
      'página siguiente.',
    security,
    middleware: guard(),
    request: { query: AdminUsersQuerySchema },
    responses: {
      200: { description: 'Página de usuarios', content: json(AdminUsersResponseSchema) },
      400: error('VALIDATION_ERROR: límite o cursor inválidos'),
      ...commonErrors,
    },
  });

  const grantRoute = createRoute({
    method: 'post',
    path: openapiPath(AdminRoutes.USER_ROLES),
    tags: ['admin'],
    summary: 'Otorgar un rol de personal',
    description:
      'Otorga ADMIN, DISPATCHER o TOUR_OPERATOR y guarda quién lo hizo (granted_by y ' +
      'role_audit). Idempotente: si ya lo tenía responde 200 sin cambios.',
    security,
    middleware: guard(),
    request: {
      params: z.object({ userId: UserIdParam }),
      body: { required: true, content: json(GrantBodySchema) },
    },
    responses: {
      200: { description: 'Usuario con sus roles', content: json(AdminUserSchema) },
      400: error('ROLE_NOT_GRANTABLE (PASSENGER o DRIVER) o VALIDATION_ERROR'),
      ...commonErrors,
      404: error('NOT_FOUND: el usuario no existe'),
    },
  });

  const revokeRoute = createRoute({
    method: 'delete',
    path: openapiPath(AdminRoutes.USER_ROLE),
    tags: ['admin'],
    summary: 'Retirar un rol de personal',
    description:
      'Retira ADMIN, DISPATCHER o TOUR_OPERATOR y lo registra en role_audit. Idempotente. Un ' +
      'administrador no puede retirarse su propio ADMIN, así que siempre queda al menos uno.',
    security,
    middleware: guard(),
    request: { params: z.object({ userId: UserIdParam, role: RoleParam }) },
    responses: {
      200: { description: 'Usuario con sus roles', content: json(AdminUserSchema) },
      400: error('ROLE_NOT_GRANTABLE (PASSENGER o DRIVER) o VALIDATION_ERROR'),
      ...commonErrors,
      404: error('NOT_FOUND: el usuario no existe'),
      409: error('CANNOT_REVOKE_OWN_ADMIN'),
    },
  });

  return createRouter()
    .openapi(listRoute, async (c) => {
      const page = await build.listUsers(c.env)(c.req.valid('query'));
      c.header('Cache-Control', 'no-store');
      return c.json(page, 200);
    })
    .openapi(grantRoute, async (c) => {
      const { userId } = c.req.valid('param');
      const { role } = c.req.valid('json');
      const user = await build.grantRole(c.env)(getActor(c), { userId, role });
      return c.json(user, 200);
    })
    .openapi(revokeRoute, async (c) => {
      const { userId, role } = c.req.valid('param');
      const user = await build.revokeRole(c.env)(getActor(c), { userId, role });
      return c.json(user, 200);
    });
}
