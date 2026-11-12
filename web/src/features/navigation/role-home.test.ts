import { STAFF_ROLES } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { STAFF_HOME } from './role-home';

describe('STAFF_HOME', () => {
  it('asigna un panel distinto a cada rol de personal', () => {
    const paths = STAFF_ROLES.map((role) => STAFF_HOME[role]);
    expect(paths).toEqual(['/admin', '/despacho', '/operador']);
  });
});
