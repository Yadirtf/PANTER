import { Role, STAFF_ROLES, type StaffRole } from '@panter/contracts';

export type AppPath = `/${string}`;

/** Panel de inicio de cada rol de personal (sección 5.3). Lo usa middleware.ts (HU-107). */
export const STAFF_HOME: Record<StaffRole, AppPath> = {
  [Role.ADMIN]: '/admin',
  [Role.DISPATCHER]: '/despacho',
  [Role.TOUR_OPERATOR]: '/operador',
};

export const STAFF_PANEL_LABEL: Record<StaffRole, string> = {
  [Role.ADMIN]: 'Panel administrativo',
  [Role.DISPATCHER]: 'Consola de despacho',
  [Role.TOUR_OPERATOR]: 'Panel de operador turístico',
};

/**
 * Roles que pueden entrar al panel de cada rol. ADMIN entra también a despacho y operador.
 * La autorización real la decide la API (`requireRole()`); esto es solo navegación.
 */
export const PANEL_ALLOWED_ROLES: Record<StaffRole, readonly StaffRole[]> = {
  [Role.ADMIN]: [Role.ADMIN],
  [Role.DISPATCHER]: [Role.DISPATCHER, Role.ADMIN],
  [Role.TOUR_OPERATOR]: [Role.TOUR_OPERATOR, Role.ADMIN],
};

export const PUBLIC_HOME = '/';
export const LOGIN_PATH = '/login';
/** Página 403 para una ruta privada cuyo rol no corresponde. */
export const FORBIDDEN_PATH = '/prohibido';
/** Página 403 para una sesión sin roles de personal (pasajeros y conductores). */
export const STAFF_ONLY_PATH = '/solo-personal';

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Panel privado al que pertenece la ruta, o `null` si la ruta no es de un panel. */
export function panelForPath(pathname: string): StaffRole | null {
  return STAFF_ROLES.find((role) => matchesPrefix(pathname, STAFF_HOME[role])) ?? null;
}

export function isPrivatePath(pathname: string): boolean {
  return panelForPath(pathname) !== null;
}

export function staffRolesOf(roles: readonly Role[]): StaffRole[] {
  return STAFF_ROLES.filter((role) => roles.includes(role));
}

export function canAccessPanel(roles: readonly Role[], panel: StaffRole): boolean {
  return PANEL_ALLOWED_ROLES[panel].some((role) => roles.includes(role));
}

/** ¿Puede la sesión con estos roles entrar a la ruta? Las rutas no privadas siempre se permiten. */
export function canAccessPath(roles: readonly Role[], pathname: string): boolean {
  const panel = panelForPath(pathname);
  return panel === null || canAccessPanel(roles, panel);
}

/** Paneles que la sesión puede abrir, en el orden de STAFF_ROLES. */
export function accessiblePanels(roles: readonly Role[]): StaffRole[] {
  return STAFF_ROLES.filter((panel) => canAccessPanel(roles, panel));
}

/**
 * Panel de inicio según los roles: ADMIN, luego DISPATCHER, luego TOUR_OPERATOR.
 * `null` si no tiene roles de personal.
 */
export function homeForRoles(roles: readonly Role[]): AppPath | null {
  const [first] = staffRolesOf(roles);
  return first ? STAFF_HOME[first] : null;
}

/**
 * Acepta solo rutas relativas del mismo sitio (evita redirecciones abiertas como `//evil.com`).
 */
export function safeNextPath(next: string | null | undefined): AppPath | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  try {
    const url = new URL(next, 'https://panter.invalid');
    if (url.origin !== 'https://panter.invalid') return null;
    return `${url.pathname}${url.search}` as AppPath;
  } catch {
    return null;
  }
}

/**
 * Destino tras iniciar sesión: `next` si es un panel al que el rol puede entrar; si no, el
 * panel de inicio del rol. `null` si la sesión no tiene roles de personal.
 */
export function postLoginPath(roles: readonly Role[], next?: string | null): AppPath | null {
  const home = homeForRoles(roles);
  if (!home) return null;
  const target = safeNextPath(next);
  if (!target) return home;
  const pathname = target.split('?')[0]!;
  return isPrivatePath(pathname) && canAccessPath(roles, pathname) ? target : home;
}

/** Decisión de navegación para una ruta privada o para /login. */
export type AccessDecision =
  | { kind: 'allow' }
  | { kind: 'login'; next: string }
  | { kind: 'redirect'; to: AppPath }
  | { kind: 'forbidden' }
  | { kind: 'staff-only' };

/**
 * Matriz de acceso de la web (HU-107). `roles` es `null` si no hay sesión válida.
 * - Ruta privada sin sesión → login con `next`.
 * - Sesión sin roles de personal → aviso "usa la app PANTER" (403).
 * - Rol que no corresponde → 403.
 * - /login con sesión de personal → panel del rol (o `next` si corresponde).
 */
export function decideAccess(
  pathname: string,
  search: string,
  roles: readonly Role[] | null,
): AccessDecision {
  if (pathname === LOGIN_PATH) {
    if (!roles) return { kind: 'allow' };
    const target = postLoginPath(roles, new URLSearchParams(search).get('next'));
    return target ? { kind: 'redirect', to: target } : { kind: 'staff-only' };
  }

  const panel = panelForPath(pathname);
  if (!panel) return { kind: 'allow' };
  if (!roles) return { kind: 'login', next: `${pathname}${search}` };
  if (staffRolesOf(roles).length === 0) return { kind: 'staff-only' };
  return canAccessPanel(roles, panel) ? { kind: 'allow' } : { kind: 'forbidden' };
}
