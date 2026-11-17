import { Role, STAFF_ROLES } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  accessiblePanels,
  canAccessPath,
  decideAccess,
  homeForRoles,
  panelForPath,
  postLoginPath,
  safeNextPath,
  STAFF_HOME,
} from './role-home';

const ALL_ROLES = Object.values(Role);

/** Todas las combinaciones no vacías de roles (2^5 - 1 = 31). */
const ROLE_SETS: Role[][] = Array.from({ length: 2 ** ALL_ROLES.length - 1 }, (_, i) =>
  ALL_ROLES.filter((_, bit) => ((i + 1) >> bit) & 1),
);

/** Matriz esperada, escrita aparte de la implementación: panel → roles que pueden entrar. */
const EXPECTED_ACCESS: Record<string, Role[]> = {
  '/admin': [Role.ADMIN],
  '/despacho': [Role.ADMIN, Role.DISPATCHER],
  '/operador': [Role.ADMIN, Role.TOUR_OPERATOR],
};

function expectedHome(roles: Role[]): string | null {
  if (roles.includes(Role.ADMIN)) return '/admin';
  if (roles.includes(Role.DISPATCHER)) return '/despacho';
  if (roles.includes(Role.TOUR_OPERATOR)) return '/operador';
  return null;
}

const isStaff = (roles: Role[]) => expectedHome(roles) !== null;

describe('STAFF_HOME', () => {
  it('asigna un panel distinto a cada rol de personal', () => {
    const paths = STAFF_ROLES.map((role) => STAFF_HOME[role]);
    expect(paths).toEqual(['/admin', '/despacho', '/operador']);
  });
});

describe('panelForPath', () => {
  it('reconoce el panel y sus subrutas, y nada más', () => {
    expect(panelForPath('/admin')).toBe(Role.ADMIN);
    expect(panelForPath('/admin/usuarios/1')).toBe(Role.ADMIN);
    expect(panelForPath('/despacho')).toBe(Role.DISPATCHER);
    expect(panelForPath('/operador/reservas')).toBe(Role.TOUR_OPERATOR);
    expect(panelForPath('/')).toBeNull();
    expect(panelForPath('/login')).toBeNull();
    expect(panelForPath('/administracion')).toBeNull();
    expect(panelForPath('/despachos')).toBeNull();
  });
});

describe('matriz de acceso (las 31 combinaciones de roles × los 3 paneles)', () => {
  const cases = ROLE_SETS.flatMap((roles) =>
    Object.keys(EXPECTED_ACCESS).map((panel) => ({ roles, panel })),
  );

  it.each(cases)('$roles en $panel', ({ roles, panel }) => {
    const allowed = EXPECTED_ACCESS[panel]!.some((role) => roles.includes(role));
    expect(canAccessPath(roles, panel)).toBe(allowed);
    expect(canAccessPath(roles, `${panel}/detalle`)).toBe(allowed);

    const decision = decideAccess(panel, '', roles);
    if (!isStaff(roles)) expect(decision).toEqual({ kind: 'staff-only' });
    else expect(decision).toEqual(allowed ? { kind: 'allow' } : { kind: 'forbidden' });
  });

  it('las rutas públicas se permiten con cualquier rol y sin sesión', () => {
    for (const roles of [...ROLE_SETS, null]) {
      expect(decideAccess('/', '', roles)).toEqual({ kind: 'allow' });
      expect(decideAccess('/prohibido', '', roles)).toEqual({ kind: 'allow' });
    }
  });

  it('sin sesión, una ruta privada lleva al login conservando la ruta', () => {
    expect(decideAccess('/despacho/alertas', '?id=7', null)).toEqual({
      kind: 'login',
      next: '/despacho/alertas?id=7',
    });
  });
});

describe('homeForRoles y /login con sesión', () => {
  it.each(ROLE_SETS)('%j', (...roles) => {
    const home = expectedHome(roles);
    expect(homeForRoles(roles)).toBe(home);
    expect(decideAccess('/login', '', roles)).toEqual(
      home ? { kind: 'redirect', to: home } : { kind: 'staff-only' },
    );
  });

  it('sin sesión, /login se muestra', () => {
    expect(decideAccess('/login', '', null)).toEqual({ kind: 'allow' });
  });

  it('accessiblePanels lista los paneles del rol', () => {
    expect(accessiblePanels([Role.ADMIN])).toEqual(STAFF_ROLES);
    expect(accessiblePanels([Role.DISPATCHER, Role.PASSENGER])).toEqual([Role.DISPATCHER]);
    expect(accessiblePanels([Role.DISPATCHER, Role.TOUR_OPERATOR])).toEqual([
      Role.DISPATCHER,
      Role.TOUR_OPERATOR,
    ]);
    expect(accessiblePanels([Role.PASSENGER, Role.DRIVER])).toEqual([]);
  });
});

describe('postLoginPath y next', () => {
  it('respeta next solo si es un panel permitido para el rol', () => {
    expect(postLoginPath([Role.ADMIN], '/despacho/alertas?x=1')).toBe('/despacho/alertas?x=1');
    expect(postLoginPath([Role.DISPATCHER], '/admin')).toBe('/despacho');
    expect(postLoginPath([Role.TOUR_OPERATOR], '/operador/cupos')).toBe('/operador/cupos');
    expect(postLoginPath([Role.DISPATCHER], '/')).toBe('/despacho');
    expect(postLoginPath([Role.PASSENGER], '/admin')).toBeNull();
    expect(decideAccess('/login', '?next=%2Fdespacho', [Role.ADMIN])).toEqual({
      kind: 'redirect',
      to: '/despacho',
    });
  });

  it('rechaza redirecciones a otros sitios', () => {
    for (const next of ['https://evil.com/admin', '//evil.com/admin', '/\\evil.com', 'admin', '']) {
      expect(safeNextPath(next)).toBeNull();
      expect(postLoginPath([Role.ADMIN], next)).toBe('/admin');
    }
    expect(safeNextPath('/admin?tab=1')).toBe('/admin?tab=1');
  });
});
