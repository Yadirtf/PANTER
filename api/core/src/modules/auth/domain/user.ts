import { ActiveMode, Role, type MeResponse, type UserStatus } from '@panter/contracts';

/** Cuenta con sus roles (especificación §5.1). Tipo propio del dominio, sin Drizzle. */
export interface User {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  status: UserStatus;
  roles: Role[];
}

/** Solo las cuentas ACTIVE pueden iniciar sesión; SUSPENDED y DELETED quedan bloqueadas. */
export function canSignIn(user: Pick<User, 'status'>): boolean {
  return user.status === 'ACTIVE';
}

/** Orden estable de los roles (el de `Role` en contracts), sin duplicados. */
export function sortRoles(roles: readonly Role[]): Role[] {
  const order = Object.values(Role);
  return [...new Set(roles)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/**
 * Modo activo efectivo: `driver` solo si la cuenta tiene el rol DRIVER; en cualquier otro caso
 * `passenger` (§5.3: un conductor que pierde el rol sigue entrando como pasajero).
 */
export function resolveActiveMode(roles: readonly Role[], requested: ActiveMode): ActiveMode {
  return requested === ActiveMode.DRIVER && roles.includes(Role.DRIVER)
    ? ActiveMode.DRIVER
    : ActiveMode.PASSENGER;
}

/** Perfil de la sesión (`MeResponse` de contracts). */
export function toProfile(user: User, activeMode: ActiveMode): MeResponse {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    status: user.status,
    roles: sortRoles(user.roles),
    activeMode: resolveActiveMode(user.roles, activeMode),
  };
}
