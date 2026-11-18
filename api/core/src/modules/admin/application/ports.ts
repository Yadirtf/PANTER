import type { AdminUser, StaffRole } from '@panter/contracts';
import type { UserCursor } from '../domain/user-cursor';

export interface ListUsersInput {
  /** Parte del correo, sin distinguir mayúsculas. Ausente: todos. */
  q?: string;
  limit: number;
  /** Continúa después de este usuario (orden `created_at DESC, id DESC`). */
  after?: UserCursor;
}

export interface UsersPage {
  items: AdminUser[];
  /** Cursor del último elemento si hay más resultados; null si es la última página. */
  next: UserCursor | null;
}

export interface RoleChangeInput {
  actorId: string;
  userId: string;
  role: StaffRole;
}

/**
 * Resultado de otorgar o retirar un rol, decidido en una sola sentencia atómica:
 * - `actorIsAdmin`: quien lo pide sigue siendo ADMIN y su cuenta está ACTIVE (manda la base de
 *   datos, no el token);
 * - `userExists`: la cuenta destino existe;
 * - `changed`: se insertó o borró la fila (false si ya lo tenía o ya no lo tenía).
 */
export interface RoleChangeResult {
  actorIsAdmin: boolean;
  userExists: boolean;
  changed: boolean;
}

/** Puerto: usuarios y roles de personal (Postgres), con registro en `role_audit`. */
export interface StaffRoleRepository {
  listUsers(input: ListUsersInput): Promise<UsersPage>;
  findUser(id: string): Promise<AdminUser | null>;
  /** Otorga el rol con `granted_by` = actor y registra `grant` si hubo cambio. */
  grantRole(input: RoleChangeInput): Promise<RoleChangeResult>;
  /** Retira el rol y registra `revoke` si hubo cambio. */
  revokeRole(input: RoleChangeInput): Promise<RoleChangeResult>;
}
