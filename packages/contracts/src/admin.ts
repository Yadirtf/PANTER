import { z } from 'zod';
import { UserStatusSchema } from './auth';
import { type Role, RoleSchema, STAFF_ROLES } from './enums';

/**
 * Gestión de usuarios y roles de personal (HU-108). Solo ADMIN.
 * Los roles PASSENGER y DRIVER no se otorgan aquí: PASSENGER es automático y DRIVER llega con
 * la aprobación de documentos (HU-204).
 */
export const AdminRoutes = {
  /** GET ?q=<correo o parte>&cursor=&limit= */
  USERS: '/admin/users',
  /** POST { role } otorga un rol de personal. */
  USER_ROLES: '/admin/users/:userId/roles',
  /** DELETE retira un rol de personal. */
  USER_ROLE: '/admin/users/:userId/roles/:role',
} as const;

/** Construye la ruta concreta de AdminRoutes.USER_ROLES / USER_ROLE. */
export function adminUserRolesPath(userId: string, role?: Role): string {
  const base = `/admin/users/${encodeURIComponent(userId)}/roles`;
  return role ? `${base}/${role}` : base;
}

export const StaffRoleSchema = z.enum(STAFF_ROLES);

export const AdminUsersQuerySchema = z.object({
  q: z.string().trim().max(254).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminUsersQuery = z.infer<typeof AdminUsersQuerySchema>;

export const RoleGrantSchema = z.object({
  role: RoleSchema,
  grantedAt: z.iso.datetime(),
  /** Correo de quien lo otorgó, o null si fue automático (PASSENGER) o por el sistema. */
  grantedBy: z.string().nullable(),
});
export type RoleGrant = z.infer<typeof RoleGrantSchema>;

export const AdminUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string().nullable(),
  status: UserStatusSchema,
  roles: z.array(RoleGrantSchema),
  createdAt: z.iso.datetime(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUsersResponseSchema = z.object({
  items: z.array(AdminUserSchema),
  nextCursor: z.string().nullable(),
});
export type AdminUsersResponse = z.infer<typeof AdminUsersResponseSchema>;

// POST /admin/users/:userId/roles → 200 AdminUser (idempotente si ya lo tenía).
// Roles que no son de personal → 400 ROLE_NOT_GRANTABLE.
export const GrantStaffRoleBodySchema = z.object({ role: StaffRoleSchema });
export type GrantStaffRoleBody = z.infer<typeof GrantStaffRoleBodySchema>;

// DELETE /admin/users/:userId/roles/:role → 200 AdminUser.
// Un ADMIN que intenta retirarse su propio ADMIN → 409 CANNOT_REVOKE_OWN_ADMIN.
