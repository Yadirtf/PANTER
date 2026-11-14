import { type ActiveMode, type MeResponse, Role } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { makeUser } from '../test/fake-api';
import {
  canSwitchMode,
  resolveRootGroup,
  ROOT_GROUPS,
  type RootGroup,
  type RootSession,
} from './root-group';

const { PASSENGER: P, DRIVER: D, ADMIN: A, DISPATCHER: S, TOUR_OPERATOR: T } = Role;

function signedIn(roles: Role[], activeMode: ActiveMode): RootSession {
  const user: MeResponse = makeUser({ roles, activeMode });
  return { status: 'signedIn', user, activeMode };
}

describe('resolveRootGroup', () => {
  it('declara los grupos de rutas', () => {
    expect(ROOT_GROUPS).toEqual([
      '(auth)',
      '(web-only)',
      '(onboarding)',
      '(passenger)',
      '(driver)',
    ]);
  });

  it.each([
    ['loading', { status: 'loading', user: null, activeMode: null }],
    ['signedOut', { status: 'signedOut', user: null, activeMode: null }],
    ['signedIn sin usuario', { status: 'signedIn', user: null, activeMode: null }],
  ] as [string, RootSession][])('sin sesión (%s) → (auth)', (_name, session) => {
    expect(resolveRootGroup(session)).toBe('(auth)');
  });

  // Tabla: roles × modo activo → grupo.
  it.each<[Role[], ActiveMode, RootGroup]>([
    // Pasajero
    [[P], 'passenger', '(passenger)'],
    [[P], 'driver', '(onboarding)'],
    // Conductor aprobado
    [[P, D], 'passenger', '(passenger)'],
    [[P, D], 'driver', '(driver)'],
    [[D], 'passenger', '(passenger)'],
    [[D], 'driver', '(driver)'],
    // Solo personal → aviso "Usa la web", sea cual sea el modo
    [[A], 'passenger', '(web-only)'],
    [[A], 'driver', '(web-only)'],
    [[S], 'passenger', '(web-only)'],
    [[T], 'driver', '(web-only)'],
    [[A, S, T], 'passenger', '(web-only)'],
    // Personal que además es pasajero o conductor usa la app como tal
    [[P, A], 'passenger', '(passenger)'],
    [[P, S], 'driver', '(onboarding)'],
    [[D, T], 'driver', '(driver)'],
    [[P, D, A, S, T], 'driver', '(driver)'],
    [[P, D, A, S, T], 'passenger', '(passenger)'],
  ])('roles %j en modo %s → %s', (roles, mode, expected) => {
    expect(resolveRootGroup(signedIn(roles, mode))).toBe(expected);
  });

  it('cubre las 31 combinaciones de roles en ambos modos', () => {
    const all = [P, D, A, S, T];
    for (let mask = 1; mask < 1 << all.length; mask += 1) {
      const roles = all.filter((_, i) => mask & (1 << i));
      const app = roles.includes(P) || roles.includes(D);
      for (const mode of ['passenger', 'driver'] as const) {
        const group = resolveRootGroup(signedIn(roles, mode));
        const label = `${roles.join('+')} / ${mode}`;
        if (!app) expect(group, label).toBe('(web-only)');
        else if (mode === 'passenger') expect(group, label).toBe('(passenger)');
        else expect(group, label).toBe(roles.includes(D) ? '(driver)' : '(onboarding)');
      }
    }
  });

  it('usa el activeMode del store (el del token) por encima del guardado en user', () => {
    const user = makeUser({ roles: [P, D], activeMode: 'passenger' });
    expect(resolveRootGroup({ status: 'signedIn', user, activeMode: 'driver' })).toBe('(driver)');
  });
});

describe('canSwitchMode', () => {
  it('solo con el rol DRIVER', () => {
    expect(canSwitchMode([P])).toBe(false);
    expect(canSwitchMode([P, A])).toBe(false);
    expect(canSwitchMode([P, D])).toBe(true);
    expect(canSwitchMode([D])).toBe(true);
  });
});
