import type { Env } from '../env';
import type { StaffRoleRepository } from '../modules/admin/application/ports';
import {
  makeGrantStaffRole,
  makeListUsers,
  makeRevokeStaffRole,
} from '../modules/admin/application/staff-roles';
import type { AdminFactories } from '../modules/admin/http/routes';
import { createDrizzleStaffRoleRepository } from '../modules/admin/infrastructure/drizzle-staff-role-repository';
import { buildDb } from './db';

/** Raíz de composición del módulo admin (HU-108). `repo` se reemplaza en las pruebas. */
export function buildAdminFactories(
  overrides: { repo?: (env: Env) => StaffRoleRepository } = {},
): AdminFactories {
  const repo = overrides.repo ?? ((env: Env) => createDrizzleStaffRoleRepository(buildDb(env)));
  return {
    listUsers: (env) => makeListUsers({ repo: repo(env) }),
    grantRole: (env) => makeGrantStaffRole({ repo: repo(env) }),
    revokeRole: (env) => makeRevokeStaffRole({ repo: repo(env) }),
  };
}
