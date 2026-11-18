// Doble en memoria del puerto StaffRoleRepository (HU-108). Imita las reglas del repositorio
// Drizzle: el actor debe ser ADMIN activo, cambios idempotentes y auditoría solo si cambió.
import { Role, type AdminUser, type UserStatus } from '@panter/contracts';
import type {
  ListUsersInput,
  RoleChangeInput,
  StaffRoleRepository,
} from '../../src/modules/admin/application/ports';

interface StoredUser {
  id: string;
  email: string;
  fullName: string | null;
  status: UserStatus;
  createdAt: string;
  roles: { role: Role; grantedAt: string; grantedBy: string | null }[];
}

export class MemoryStaffRoleRepository implements StaffRoleRepository {
  readonly users = new Map<string, StoredUser>();
  readonly audit: { actorId: string; userId: string; role: Role; action: 'grant' | 'revoke' }[] =
    [];
  private seq = 0;

  add(
    email: string,
    roles: Role[] = [Role.PASSENGER],
    options: { id?: string; status?: UserStatus } = {},
  ): StoredUser {
    this.seq++;
    const user: StoredUser = {
      id: options.id ?? `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`,
      email,
      fullName: null,
      status: options.status ?? 'ACTIVE',
      // Un microsegundo más tarde por cuenta: el orden de creación es el de inserción.
      createdAt: `2026-11-18T12:00:00.${String(this.seq).padStart(6, '0')}Z`,
      roles: roles.map((role) => ({
        role,
        grantedAt: '2026-11-18T12:00:00.000Z',
        grantedBy: null,
      })),
    };
    this.users.set(user.id, user);
    return user;
  }

  private view(user: StoredUser): AdminUser {
    const order: string[] = Object.values(Role);
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      status: user.status,
      createdAt: user.createdAt.replace(/(\.\d{3})\d+Z$/, '$1Z'),
      roles: [...user.roles]
        .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role))
        .map((r) => ({
          ...r,
          grantedBy: r.grantedBy ? (this.users.get(r.grantedBy)?.email ?? null) : null,
        })),
    };
  }

  async listUsers({ q, limit, after }: ListUsersInput) {
    const sorted = [...this.users.values()]
      .filter((u) => !q || u.email.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .filter(
        (u) =>
          !after ||
          u.createdAt < after.createdAt ||
          (u.createdAt === after.createdAt && u.id < after.id),
      );
    const page = sorted.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((u) => this.view(u)),
      next: sorted.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  async findUser(id: string) {
    const user = this.users.get(id);
    return user ? this.view(user) : null;
  }

  private actorIsAdmin(actorId: string) {
    const actor = this.users.get(actorId);
    return !!actor && actor.status === 'ACTIVE' && actor.roles.some((r) => r.role === Role.ADMIN);
  }

  async grantRole({ actorId, userId, role }: RoleChangeInput) {
    const actorIsAdmin = this.actorIsAdmin(actorId);
    const user = this.users.get(userId);
    let changed = false;
    if (actorIsAdmin && user && !user.roles.some((r) => r.role === role)) {
      user.roles.push({ role, grantedAt: new Date().toISOString(), grantedBy: actorId });
      this.audit.push({ actorId, userId, role, action: 'grant' });
      changed = true;
    }
    return { actorIsAdmin, userExists: !!user, changed };
  }

  async revokeRole({ actorId, userId, role }: RoleChangeInput) {
    const actorIsAdmin = this.actorIsAdmin(actorId);
    const user = this.users.get(userId);
    let changed = false;
    if (actorIsAdmin && user && user.roles.some((r) => r.role === role)) {
      user.roles = user.roles.filter((r) => r.role !== role);
      this.audit.push({ actorId, userId, role, action: 'revoke' });
      changed = true;
    }
    return { actorIsAdmin, userExists: !!user, changed };
  }
}
