// Datos solo para pruebas de la gestión de usuarios (HU-108).
import { Role, type AdminUser } from '@panter/contracts';
import { USER_ID } from '@/features/auth/server/test-helpers';

export const ADMIN_ID = USER_ID;
export const OTHER_ID = '7b1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
export const THIRD_ID = '9c8d7e6f-5a4b-4c3d-9e2f-1a0b9c8d7e6f';

export function adminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: ADMIN_ID,
    email: 'admin@panter.test',
    fullName: 'Ana Administradora',
    status: 'ACTIVE',
    roles: [
      { role: Role.PASSENGER, grantedAt: '2026-11-01T14:00:00.000Z', grantedBy: null },
      { role: Role.ADMIN, grantedAt: '2026-11-02T15:30:00.000Z', grantedBy: 'raiz@panter.test' },
    ],
    createdAt: '2026-11-01T14:00:00.000Z',
    ...overrides,
  };
}

export function otherUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: OTHER_ID,
    email: 'despacho@panter.test',
    fullName: null,
    status: 'ACTIVE',
    roles: [
      { role: Role.PASSENGER, grantedAt: '2026-11-03T14:00:00.000Z', grantedBy: null },
      { role: Role.ADMIN, grantedAt: '2026-11-04T14:00:00.000Z', grantedBy: 'admin@panter.test' },
      {
        role: Role.DISPATCHER,
        grantedAt: '2026-11-05T14:00:00.000Z',
        grantedBy: 'admin@panter.test',
      },
    ],
    createdAt: '2026-11-03T14:00:00.000Z',
    ...overrides,
  };
}
