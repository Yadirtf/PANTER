import {
  type ActiveMode,
  type ConsentStatus,
  type MeResponse,
  PRIVACY_POLICY_VERSION,
  Role,
} from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { makeUser } from '../test/fake-api';
import {
  canSwitchMode,
  needsConsent,
  resolveRootGroup,
  ROOT_GROUPS,
  type RootGroup,
  type RootSession,
} from './root-group';

const { PASSENGER: P, DRIVER: D, ADMIN: A, DISPATCHER: S, TOUR_OPERATOR: T } = Role;

function signedIn(roles: Role[], activeMode: ActiveMode, consent?: ConsentStatus): RootSession {
  const user: MeResponse = makeUser({ roles, activeMode, ...(consent ? { consent } : {}) });
  return { status: 'signedIn', user, activeMode };
}

const PENDING: ConsentStatus = {
  currentVersion: PRIVACY_POLICY_VERSION,
  acceptedVersion: null,
  acceptedAt: null,
  required: true,
};
const NEW_VERSION: ConsentStatus = {
  currentVersion: PRIVACY_POLICY_VERSION,
  acceptedVersion: '2026-01-v0',
  acceptedAt: '2026-01-10T15:00:00.000Z',
  required: true,
};
const ACCEPTED: ConsentStatus = {
  currentVersion: PRIVACY_POLICY_VERSION,
  acceptedVersion: PRIVACY_POLICY_VERSION,
  acceptedAt: '2026-11-18T15:00:00.000Z',
  required: false,
};

describe('resolveRootGroup', () => {
  it('declara los grupos de rutas', () => {
    expect(ROOT_GROUPS).toEqual([
      '(auth)',
      '(consent)',
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

  // Tabla: consentimiento × roles × modo. Pendiente → (consent) antes que cualquier otro grupo;
  // aceptado o sin el campo (API anterior a HU-109) → navegación normal.
  it.each<[string, ConsentStatus | undefined, Role[], ActiveMode, RootGroup]>([
    ['nunca aceptó', PENDING, [P], 'passenger', '(consent)'],
    ['nunca aceptó', PENDING, [P], 'driver', '(consent)'],
    ['nunca aceptó', PENDING, [P, D], 'driver', '(consent)'],
    ['nunca aceptó', PENDING, [D], 'passenger', '(consent)'],
    ['nunca aceptó', PENDING, [A], 'passenger', '(consent)'],
    ['nunca aceptó', PENDING, [P, D, A, S, T], 'driver', '(consent)'],
    ['versión nueva', NEW_VERSION, [P], 'passenger', '(consent)'],
    ['versión nueva', NEW_VERSION, [P, D], 'driver', '(consent)'],
    ['versión nueva', NEW_VERSION, [S, T], 'passenger', '(consent)'],
    ['aceptado', ACCEPTED, [P], 'passenger', '(passenger)'],
    ['aceptado', ACCEPTED, [P], 'driver', '(onboarding)'],
    ['aceptado', ACCEPTED, [P, D], 'driver', '(driver)'],
    ['aceptado', ACCEPTED, [A], 'driver', '(web-only)'],
    ['sin consent', undefined, [P], 'passenger', '(passenger)'],
    ['sin consent', undefined, [P, D], 'driver', '(driver)'],
    ['sin consent', undefined, [A], 'passenger', '(web-only)'],
  ])('consentimiento %s, roles %j en modo %s → %s', (_name, consent, roles, mode, expected) => {
    expect(resolveRootGroup(signedIn(roles, mode, consent))).toBe(expected);
  });

  it('sin sesión gana sobre el consentimiento pendiente', () => {
    const user = makeUser({ consent: PENDING });
    expect(resolveRootGroup({ status: 'signedOut', user, activeMode: null })).toBe('(auth)');
    expect(resolveRootGroup({ status: 'loading', user, activeMode: null })).toBe('(auth)');
  });

  it('con consentimiento pendiente, las 31 combinaciones de roles van a (consent)', () => {
    const all = [P, D, A, S, T];
    for (let mask = 1; mask < 1 << all.length; mask += 1) {
      const roles = all.filter((_, i) => mask & (1 << i));
      for (const mode of ['passenger', 'driver'] as const) {
        expect(resolveRootGroup(signedIn(roles, mode, PENDING)), roles.join('+')).toBe('(consent)');
      }
    }
  });

  it('usa el activeMode del store (el del token) por encima del guardado en user', () => {
    const user = makeUser({ roles: [P, D], activeMode: 'passenger' });
    expect(resolveRootGroup({ status: 'signedIn', user, activeMode: 'driver' })).toBe('(driver)');
  });
});

describe('needsConsent', () => {
  it('solo cuando la API marca required', () => {
    expect(needsConsent({ consent: PENDING })).toBe(true);
    expect(needsConsent({ consent: NEW_VERSION })).toBe(true);
    expect(needsConsent({ consent: ACCEPTED })).toBe(false);
    expect(needsConsent({})).toBe(false);
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
