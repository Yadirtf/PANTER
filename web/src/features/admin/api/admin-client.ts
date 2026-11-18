import {
  AdminUserSchema,
  AdminUsersResponseSchema,
  type AdminUser,
  type AdminUsersResponse,
  type StaffRole,
} from '@panter/contracts';
import { createHttpClient, type HttpClient } from '@/shared/api/http-client';

/** Rutas BFF de la gestión de usuarios (mismo origen que la web; sin tokens en el navegador). */
export const AdminBffRoutes = {
  USERS: '/api/admin/users',
  userRoles: (userId: string) => `/api/admin/users/${encodeURIComponent(userId)}/roles`,
  userRole: (userId: string, role: StaffRole) =>
    `/api/admin/users/${encodeURIComponent(userId)}/roles/${role}`,
} as const;

export interface AdminClientConfig {
  /** Origen de la web; por defecto `window.location.origin`. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

function client(config: AdminClientConfig): HttpClient {
  return createHttpClient({
    baseUrl: config.baseUrl ?? window.location.origin,
    fetch: config.fetch,
  });
}

export function fetchUsersPage(
  params: { q?: string; cursor?: string },
  config: AdminClientConfig = {},
): Promise<AdminUsersResponse> {
  return client(config).get(AdminBffRoutes.USERS, {
    schema: AdminUsersResponseSchema,
    query: { q: params.q || undefined, cursor: params.cursor },
  });
}

export function grantRole(
  userId: string,
  role: StaffRole,
  config: AdminClientConfig = {},
): Promise<AdminUser> {
  return client(config).post(AdminBffRoutes.userRoles(userId), {
    schema: AdminUserSchema,
    body: { role },
  });
}

export function revokeRole(
  userId: string,
  role: StaffRole,
  config: AdminClientConfig = {},
): Promise<AdminUser> {
  return client(config).delete(AdminBffRoutes.userRole(userId, role), { schema: AdminUserSchema });
}
