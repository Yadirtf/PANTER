import {
  Role,
  STAFF_ROLES,
  type AdminUser,
  type AdminUsersResponse,
  type RoleGrant,
  type StaffRole,
  type UserStatus,
} from '@panter/contracts';

export const ADMIN_USERS_PATH = '/admin/usuarios';

export const ROLE_LABEL: Record<Role, string> = {
  [Role.ADMIN]: 'Administrador',
  [Role.DISPATCHER]: 'Despacho',
  [Role.TOUR_OPERATOR]: 'Operador turístico',
  [Role.PASSENGER]: 'Pasajero',
  [Role.DRIVER]: 'Conductor',
};

export const STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: 'Activa',
  SUSPENDED: 'Suspendida',
  DELETED: 'Eliminada',
};

/** Roles de personal que se gestionan desde /admin/usuarios. */
export const MANAGED_ROLES: readonly StaffRole[] = STAFF_ROLES;

export function hasRole(user: AdminUser, role: Role): boolean {
  return user.roles.some((grant) => grant.role === role);
}

/** Roles de personal que el usuario todavía no tiene. */
export function grantableRoles(user: AdminUser): StaffRole[] {
  return MANAGED_ROLES.filter((role) => !hasRole(user, role));
}

/**
 * ¿Se muestra el botón "Retirar"? Solo para roles de personal y nunca para el ADMIN de quien
 * está usando el panel (la API lo rechaza igual con CANNOT_REVOKE_OWN_ADMIN).
 */
export function canRevoke(currentUserId: string, user: AdminUser, role: Role): boolean {
  if (!(MANAGED_ROLES as readonly Role[]).includes(role)) return false;
  return !(role === Role.ADMIN && user.id === currentUserId);
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** Colombia no tiene horario de verano: UTC−5 todo el año. */
const COLOMBIA_OFFSET_MS = -5 * 60 * 60 * 1000;

/**
 * "2 nov 2026, 10:30" en hora de Colombia. Se arma a mano y no con Intl para que el servidor
 * (Worker) y el navegador produzcan exactamente el mismo texto, sin depender de su ICU.
 */
export function formatDate(iso: string): string {
  const local = new Date(new Date(iso).getTime() + COLOMBIA_OFFSET_MS);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}, ${hh}:${mm}`;
}

/** "Otorgado por ana@x.co el 18 nov 2026, 9:30 a. m." */
export function grantDescription(grant: RoleGrant): string {
  const by = grant.grantedBy ? `por ${grant.grantedBy}` : 'automáticamente';
  return `Otorgado ${by} el ${formatDate(grant.grantedAt)}`;
}

/** Lista paginada que se muestra en la tabla. */
export interface UsersListState {
  items: AdminUser[];
  nextCursor: string | null;
}

/** Agrega la página siguiente ("Cargar más") sin duplicar usuarios. */
export function appendPage(state: UsersListState, page: AdminUsersResponse): UsersListState {
  const seen = new Set(state.items.map((user) => user.id));
  return {
    items: [...state.items, ...page.items.filter((user) => !seen.has(user.id))],
    nextCursor: page.nextCursor,
  };
}

/** Reemplaza un usuario tras otorgar o retirar un rol (la API devuelve el usuario completo). */
export function replaceUser(state: UsersListState, user: AdminUser): UsersListState {
  return { ...state, items: state.items.map((item) => (item.id === user.id ? user : item)) };
}
