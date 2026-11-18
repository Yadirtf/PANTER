import { describe, expect, it } from 'vitest';
import {
  AcceptConsentBodySchema,
  AdminUsersQuerySchema,
  AdminUsersResponseSchema,
  ConsentStatusSchema,
  GrantStaffRoleBodySchema,
  MeResponseSchema,
  PRIVACY_POLICY_VERSION,
  adminUserRolesPath,
} from './index';

const id = '3f0b7f2e-8a51-4a43-9d2c-1f1f2a3b4c5d';

describe('contratos de administración', () => {
  it('solo se otorgan roles de personal', () => {
    expect(GrantStaffRoleBodySchema.safeParse({ role: 'ADMIN' }).success).toBe(true);
    expect(GrantStaffRoleBodySchema.safeParse({ role: 'DRIVER' }).success).toBe(false);
    expect(GrantStaffRoleBodySchema.safeParse({ role: 'PASSENGER' }).success).toBe(false);
  });

  it('consulta con límite por defecto y máximo', () => {
    expect(AdminUsersQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(AdminUsersQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(AdminUsersQuerySchema.parse({ q: ' ana ', limit: '5' })).toEqual({ q: 'ana', limit: 5 });
  });

  it('respuesta de listado y rutas', () => {
    const res = {
      items: [
        {
          id,
          email: 'ana@example.com',
          fullName: null,
          status: 'ACTIVE',
          roles: [{ role: 'ADMIN', grantedAt: '2026-11-18T10:00:00Z', grantedBy: 'jefe@x.co' }],
          createdAt: '2026-11-18T09:00:00Z',
        },
      ],
      nextCursor: null,
    };
    expect(AdminUsersResponseSchema.parse(res)).toEqual(res);
    expect(adminUserRolesPath(id)).toBe(`/admin/users/${id}/roles`);
    expect(adminUserRolesPath(id, 'DISPATCHER')).toBe(`/admin/users/${id}/roles/DISPATCHER`);
  });
});

describe('contratos de consentimiento', () => {
  it('estado y aceptación', () => {
    const status = {
      currentVersion: PRIVACY_POLICY_VERSION,
      acceptedVersion: null,
      acceptedAt: null,
      required: true,
    };
    expect(ConsentStatusSchema.parse(status)).toEqual(status);
    expect(AcceptConsentBodySchema.safeParse({ version: 'v1', accepted: false }).success).toBe(
      false,
    );
  });

  it('MeResponse sigue aceptando respuestas sin consent (compatibilidad)', () => {
    const me = {
      id,
      email: 'ana@example.com',
      fullName: null,
      phone: null,
      status: 'ACTIVE',
      roles: ['PASSENGER'],
      activeMode: 'passenger',
    };
    expect(MeResponseSchema.parse(me)).toEqual(me);
  });
});

describe('aviso de privacidad', () => {
  it('usa la versión vigente y tiene las secciones mínimas de la Ley 1581', async () => {
    const { PRIVACY_POLICY } = await import('./privacy-policy');
    expect(PRIVACY_POLICY.version).toBe(PRIVACY_POLICY_VERSION);
    const titles = PRIVACY_POLICY.sections.map((s) => s.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        'Responsable del tratamiento',
        'Para qué los usamos',
        'Tus derechos',
        'Autorización',
      ]),
    );
  });
});
