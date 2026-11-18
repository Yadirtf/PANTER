import type { AdminUser, AdminUsersQuery, AdminUsersResponse, Role } from '@panter/contracts';
import type { Actor } from '../../auth/domain/actor';
import { isGrantable, isOwnAdminRevoke } from '../domain/staff-roles';
import { decodeUserCursor, encodeUserCursor } from '../domain/user-cursor';
import { AdminErrors } from './errors';
import type { RoleChangeResult, StaffRoleRepository } from './ports';

/** GET /admin/users: búsqueda por correo y paginación por cursor. */
export type ListUsers = (query: AdminUsersQuery) => Promise<AdminUsersResponse>;

export function makeListUsers(deps: { repo: StaffRoleRepository }): ListUsers {
  return async ({ q, cursor, limit }) => {
    const after = cursor ? decodeUserCursor(cursor) : undefined;
    if (after === null) throw AdminErrors.invalidCursor();
    const page = await deps.repo.listUsers({ q: q?.trim() || undefined, limit, after });
    return { items: page.items, nextCursor: page.next ? encodeUserCursor(page.next) : null };
  };
}

export interface ChangeRoleInput {
  userId: string;
  role: Role;
}

/** POST /admin/users/:userId/roles y DELETE /admin/users/:userId/roles/:role. */
export type ChangeRole = (actor: Actor, input: ChangeRoleInput) => Promise<AdminUser>;

async function respond(
  repo: StaffRoleRepository,
  userId: string,
  result: RoleChangeResult,
): Promise<AdminUser> {
  if (!result.actorIsAdmin) throw AdminErrors.forbidden();
  const user = result.userExists ? await repo.findUser(userId) : null;
  if (!user) throw AdminErrors.userNotFound();
  return user;
}

/**
 * Otorga un rol de personal. Idempotente: si ya lo tenía responde igual y no deja registro.
 * PASSENGER o DRIVER → 400 `ROLE_NOT_GRANTABLE`. Usuario inexistente → 404 `NOT_FOUND`. Quien
 * lo pide debe seguir siendo ADMIN activo en la base de datos (no basta el token) → 403.
 */
export function makeGrantStaffRole(deps: { repo: StaffRoleRepository }): ChangeRole {
  return async (actor, { userId, role }) => {
    if (!isGrantable(role)) throw AdminErrors.roleNotGrantable();
    const result = await deps.repo.grantRole({ actorId: actor.userId, userId, role });
    return respond(deps.repo, userId, result);
  };
}

/**
 * Retira un rol de personal. Idempotente si no lo tenía. Retirarse el propio ADMIN → 409
 * `CANNOT_REVOKE_OWN_ADMIN`. Siempre queda al menos un ADMIN (ver `domain/staff-roles.ts`).
 */
export function makeRevokeStaffRole(deps: { repo: StaffRoleRepository }): ChangeRole {
  return async (actor, { userId, role }) => {
    if (!isGrantable(role)) throw AdminErrors.roleNotGrantable();
    if (isOwnAdminRevoke(actor.userId, userId, role)) throw AdminErrors.cannotRevokeOwnAdmin();
    const result = await deps.repo.revokeRole({ actorId: actor.userId, userId, role });
    return respond(deps.repo, userId, result);
  };
}
