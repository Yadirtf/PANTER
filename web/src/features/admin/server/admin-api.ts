import {
  AdminRoutes,
  AdminUserSchema,
  AdminUsersResponseSchema,
  adminUserRolesPath,
  type AdminUser,
  type AdminUsersResponse,
  type Role,
  type StaffRole,
} from '@panter/contracts';
import { createHttpClient } from '@/shared/api/http-client';

export interface AdminApiConfig {
  /** URL base de panter-api. */
  apiUrl: string;
  /** Inyectable para pruebas; por defecto el `fetch` global. */
  fetch?: typeof fetch;
}

export interface AdminUsersParams {
  q?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Llamadas de servidor a servidor a la gestión de usuarios (HU-108). Cada método recibe el
 * access token de la cookie y lo envía como Bearer; el navegador nunca lo ve.
 */
export interface AdminApi {
  listUsers(accessToken: string, params: AdminUsersParams): Promise<AdminUsersResponse>;
  grantRole(accessToken: string, userId: string, role: StaffRole): Promise<AdminUser>;
  revokeRole(accessToken: string, userId: string, role: Role): Promise<AdminUser>;
}

export function createAdminApi(config: AdminApiConfig): AdminApi {
  const client = (accessToken: string) =>
    createHttpClient({
      baseUrl: config.apiUrl,
      fetch: config.fetch,
      getAccessToken: () => accessToken,
    });
  return {
    listUsers: (accessToken, params) =>
      client(accessToken).get(AdminRoutes.USERS, {
        schema: AdminUsersResponseSchema,
        query: { q: params.q || undefined, cursor: params.cursor, limit: params.limit },
      }),
    grantRole: (accessToken, userId, role) =>
      client(accessToken).post(adminUserRolesPath(userId), {
        schema: AdminUserSchema,
        body: { role },
      }),
    revokeRole: (accessToken, userId, role) =>
      client(accessToken).delete(adminUserRolesPath(userId, role), { schema: AdminUserSchema }),
  };
}
