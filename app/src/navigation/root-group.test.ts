import { describe, expect, it } from 'vitest';
import { resolveRootGroup, ROOT_GROUPS } from './root-group';

describe('resolveRootGroup', () => {
  it('declara los cuatro grupos de rutas', () => {
    expect(ROOT_GROUPS).toEqual(['(auth)', '(onboarding)', '(passenger)', '(driver)']);
  });

  it('sin lógica de sesión (HU-106) siempre envía a (auth)', () => {
    expect(resolveRootGroup()).toBe('(auth)');
  });
});
