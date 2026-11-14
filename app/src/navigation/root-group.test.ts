import type { MeResponse } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { resolveRootGroup, ROOT_GROUPS } from './root-group';

const user: MeResponse = {
  id: '6f1c2a4e-8b0d-4c3e-9f7a-1b2c3d4e5f60',
  email: 'ana@example.com',
  fullName: null,
  phone: null,
  status: 'ACTIVE',
  roles: ['PASSENGER'],
  activeMode: 'passenger',
};

describe('resolveRootGroup', () => {
  it('declara los cuatro grupos de rutas', () => {
    expect(ROOT_GROUPS).toEqual(['(auth)', '(onboarding)', '(passenger)', '(driver)']);
  });

  it('sin sesión o mientras carga envía a (auth)', () => {
    expect(resolveRootGroup({ status: 'loading', user: null, activeMode: null })).toBe('(auth)');
    expect(resolveRootGroup({ status: 'signedOut', user: null, activeMode: null })).toBe('(auth)');
  });

  it('con sesión envía a (passenger)', () => {
    expect(resolveRootGroup({ status: 'signedIn', user, activeMode: 'passenger' })).toBe(
      '(passenger)',
    );
  });
});
