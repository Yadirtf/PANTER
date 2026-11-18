import { AdminUsersResponseSchema, ApiErrorCode, Role } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  makeGrantStaffRole,
  makeListUsers,
  makeRevokeStaffRole,
} from '../../../src/modules/admin/application/staff-roles';
import { isGrantable, isOwnAdminRevoke } from '../../../src/modules/admin/domain/staff-roles';
import { decodeUserCursor, encodeUserCursor } from '../../../src/modules/admin/domain/user-cursor';
import type { Actor } from '../../../src/modules/auth/domain/actor';
import { AppError } from '../../../src/shared/errors/app-error';
import { MemoryStaffRoleRepository } from '../../support/admin-fakes';

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  const err = await promise.then(
    () => {
      throw new Error('se esperaba un error');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

function setup() {
  const repo = new MemoryStaffRoleRepository();
  const admin = repo.add('admin@panter.test', [Role.PASSENGER, Role.ADMIN]);
  const actor: Actor = {
    userId: admin.id,
    roles: [Role.PASSENGER, Role.ADMIN],
    activeMode: 'passenger',
  };
  return {
    repo,
    admin,
    actor,
    list: makeListUsers({ repo }),
    grant: makeGrantStaffRole({ repo }),
    revoke: makeRevokeStaffRole({ repo }),
  };
}

describe('reglas de roles de personal (dominio)', () => {
  it('solo ADMIN, DISPATCHER y TOUR_OPERATOR se gestionan', () => {
    expect([Role.ADMIN, Role.DISPATCHER, Role.TOUR_OPERATOR].every(isGrantable)).toBe(true);
    expect(isGrantable(Role.PASSENGER)).toBe(false);
    expect(isGrantable(Role.DRIVER)).toBe(false);
  });

  it('retirarse el propio ADMIN', () => {
    expect(isOwnAdminRevoke('a', 'a', Role.ADMIN)).toBe(true);
    expect(isOwnAdminRevoke('a', 'a', Role.DISPATCHER)).toBe(false);
    expect(isOwnAdminRevoke('a', 'b', Role.ADMIN)).toBe(false);
  });

  it('cursor opaco: ida y vuelta, y rechaza cursores alterados', () => {
    const cursor = {
      createdAt: '2026-11-18T12:00:00.123456Z',
      id: '6f9619ff-8b86-4d11-b42d-00c04fc964ff',
    };
    const encoded = encodeUserCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeUserCursor(encoded)).toEqual(cursor);
    expect(decodeUserCursor(encoded.toUpperCase())).toBeNull();
    expect(decodeUserCursor('no-es-base64!')).toBeNull();
    expect(decodeUserCursor(btoa(JSON.stringify({ t: 1, i: 'x' })))).toBeNull();
    expect(decodeUserCursor(btoa(JSON.stringify({ t: 'ayer', i: cursor.id })))).toBeNull();
    expect(decodeUserCursor(btoa(JSON.stringify({ t: cursor.createdAt, i: 'x' })))).toBeNull();
  });
});

describe('listar usuarios', () => {
  it('busca por correo y pagina con cursor', async () => {
    const { repo, list } = setup();
    for (let i = 0; i < 5; i++) repo.add(`ana${i}@villagarzon.test`);
    repo.add('otro@panter.test');

    const first = await list({ q: '  ANA ', limit: 2 });
    expect(AdminUsersResponseSchema.parse(first)).toEqual(first);
    expect(first.items.map((u) => u.email)).toEqual([
      'ana4@villagarzon.test',
      'ana3@villagarzon.test',
    ]);
    const second = await list({ q: 'ana', limit: 2, cursor: first.nextCursor! });
    const third = await list({ q: 'ana', limit: 2, cursor: second.nextCursor! });
    expect(third.items.map((u) => u.email)).toEqual(['ana0@villagarzon.test']);
    expect(third.nextCursor).toBeNull();

    const all = await list({ q: '', limit: 100 });
    expect(all.items).toHaveLength(7);
  });

  it('cursor inválido → 400 VALIDATION_ERROR', async () => {
    const { list } = setup();
    const err = await errorOf(list({ limit: 10, cursor: 'basura' }));
    expect([err.code, err.status]).toEqual([ApiErrorCode.VALIDATION_ERROR, 400]);
  });
});

describe('otorgar rol', () => {
  it('otorga con grantedBy = correo del admin; idempotente sin doble auditoría', async () => {
    const { repo, actor, grant } = setup();
    const target = repo.add('despacho@panter.test');
    const user = await grant(actor, { userId: target.id, role: Role.DISPATCHER });
    expect(user.roles).toEqual([
      expect.objectContaining({ role: 'PASSENGER', grantedBy: null }),
      expect.objectContaining({ role: 'DISPATCHER', grantedBy: 'admin@panter.test' }),
    ]);
    await grant(actor, { userId: target.id, role: Role.DISPATCHER });
    expect(repo.audit).toEqual([
      { actorId: actor.userId, userId: target.id, role: Role.DISPATCHER, action: 'grant' },
    ]);
  });

  it('PASSENGER o DRIVER → 400 ROLE_NOT_GRANTABLE', async () => {
    const { repo, actor, grant, revoke } = setup();
    const target = repo.add('x@panter.test');
    for (const role of [Role.PASSENGER, Role.DRIVER]) {
      const err = await errorOf(grant(actor, { userId: target.id, role }));
      expect([err.code, err.status]).toEqual([ApiErrorCode.ROLE_NOT_GRANTABLE, 400]);
      expect((await errorOf(revoke(actor, { userId: target.id, role }))).code).toBe(
        ApiErrorCode.ROLE_NOT_GRANTABLE,
      );
    }
  });

  it('usuario inexistente → 404 NOT_FOUND', async () => {
    const { actor, grant, revoke } = setup();
    const missing = { userId: '00000000-0000-4000-8000-999999999999', role: Role.ADMIN };
    expect((await errorOf(grant(actor, missing))).status).toBe(404);
    expect((await errorOf(revoke(actor, missing))).code).toBe(ApiErrorCode.NOT_FOUND);
  });

  it('actor que ya no es ADMIN en la base de datos → 403 FORBIDDEN', async () => {
    const { repo, actor, grant, admin } = setup();
    const target = repo.add('x@panter.test');
    repo.users.get(admin.id)!.roles = [];
    const err = await errorOf(grant(actor, { userId: target.id, role: Role.ADMIN }));
    expect([err.code, err.status]).toEqual([ApiErrorCode.FORBIDDEN, 403]);
  });

  it('si la cuenta desaparece entre el cambio y la lectura → 404', async () => {
    const { repo, actor, grant } = setup();
    const target = repo.add('x@panter.test');
    repo.findUser = async () => null;
    expect((await errorOf(grant(actor, { userId: target.id, role: Role.ADMIN }))).status).toBe(404);
  });
});

describe('retirar rol', () => {
  it('retira y audita; idempotente', async () => {
    const { repo, actor, revoke } = setup();
    const target = repo.add('op@panter.test', [Role.PASSENGER, Role.TOUR_OPERATOR]);
    const user = await revoke(actor, { userId: target.id, role: Role.TOUR_OPERATOR });
    expect(user.roles.map((r) => r.role)).toEqual(['PASSENGER']);
    await revoke(actor, { userId: target.id, role: Role.TOUR_OPERATOR });
    expect(repo.audit.map((a) => a.action)).toEqual(['revoke']);
  });

  it('un ADMIN no puede quitarse su propio ADMIN → 409; sí otros roles propios', async () => {
    const { repo, actor, revoke, admin } = setup();
    const err = await errorOf(revoke(actor, { userId: admin.id, role: Role.ADMIN }));
    expect([err.code, err.status]).toEqual([ApiErrorCode.CANNOT_REVOKE_OWN_ADMIN, 409]);
    expect(repo.audit).toEqual([]);
    repo.users.get(admin.id)!.roles.push({
      role: Role.DISPATCHER,
      grantedAt: '2026-11-18T12:00:00.000Z',
      grantedBy: null,
    });
    const user = await revoke(actor, { userId: admin.id, role: Role.DISPATCHER });
    expect(user.roles.map((r) => r.role)).toEqual(['PASSENGER', 'ADMIN']);
  });

  it('un ADMIN puede retirar el ADMIN de otro', async () => {
    const { repo, actor, revoke } = setup();
    const other = repo.add('otra-admin@panter.test', [Role.ADMIN]);
    const user = await revoke(actor, { userId: other.id, role: Role.ADMIN });
    expect(user.roles).toEqual([]);
  });
});
