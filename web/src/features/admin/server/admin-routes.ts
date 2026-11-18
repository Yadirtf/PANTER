import {
  AdminUsersQuerySchema,
  ApiErrorCode,
  isStaffRole,
  RoleSchema,
  type Role,
} from '@panter/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  crossSiteResponse,
  errorJson,
  isCrossSite,
  NO_STORE,
  readJson,
  validationResponse,
} from '@/features/auth/server/bff-http';
import type { RefreshFn } from '@/features/auth/server/session-call';
import { respondWithSession } from '@/features/auth/server/session-handler';
import type { AdminApi } from './admin-api';

/**
 * Route handlers BFF de la gestión de usuarios (HU-108): `/api/admin/users/*`. Solo reenvían
 * a panter-api con el access token de la cookie; la API decide si la sesión es ADMIN.
 */
export interface AdminRouteDeps {
  admin: AdminApi;
  refresh: RefreshFn;
}

const UserIdSchema = z.uuid();
const GrantBodySchema = z.object({ role: RoleSchema });

function ok(value: unknown): NextResponse {
  return NextResponse.json(value, { status: 200, headers: NO_STORE });
}

function notFound(): NextResponse {
  return errorJson(404, ApiErrorCode.NOT_FOUND, 'Usuario no encontrado.');
}

function notGrantable(): NextResponse {
  return errorJson(
    400,
    ApiErrorCode.ROLE_NOT_GRANTABLE,
    'Solo se pueden gestionar los roles de personal.',
  );
}

/** GET /api/admin/users?q=&cursor= → GET /admin/users. */
export async function handleListUsers(
  request: NextRequest,
  deps: AdminRouteDeps,
): Promise<NextResponse> {
  if (isCrossSite(request)) return crossSiteResponse();
  const params = request.nextUrl.searchParams;
  const query = AdminUsersQuerySchema.safeParse({
    q: params.get('q') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
    limit: params.get('limit') ?? undefined,
  });
  if (!query.success) return validationResponse(query.error, 'Revisa la búsqueda.');
  return respondWithSession(
    request,
    deps.refresh,
    (token) => deps.admin.listUsers(token, query.data),
    ok,
  );
}

/** POST /api/admin/users/:userId/roles { role } → POST /admin/users/:userId/roles. */
export async function handleGrantRole(
  request: NextRequest,
  userId: string,
  deps: AdminRouteDeps,
): Promise<NextResponse> {
  const body = await readJson(request, GrantBodySchema);
  if (!body.ok) return body.response;
  if (!UserIdSchema.safeParse(userId).success) return notFound();
  const role = body.data.role;
  if (!isStaffRole(role)) return notGrantable();
  return respondWithSession(
    request,
    deps.refresh,
    (token) => deps.admin.grantRole(token, userId, role),
    ok,
  );
}

/** DELETE /api/admin/users/:userId/roles/:role → DELETE /admin/users/:userId/roles/:role. */
export async function handleRevokeRole(
  request: NextRequest,
  userId: string,
  role: string,
  deps: AdminRouteDeps,
): Promise<NextResponse> {
  if (isCrossSite(request)) return crossSiteResponse();
  if (!UserIdSchema.safeParse(userId).success) return notFound();
  const parsedRole = RoleSchema.safeParse(role);
  if (!parsedRole.success || !isStaffRole(parsedRole.data as Role)) return notGrantable();
  return respondWithSession(
    request,
    deps.refresh,
    (token) => deps.admin.revokeRole(token, userId, parsedRole.data),
    ok,
  );
}
