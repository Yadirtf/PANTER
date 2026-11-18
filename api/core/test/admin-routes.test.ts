// HU-108: rutas /admin/users dentro de workerd, con el repositorio en memoria.
import {
  adminUserRolesPath,
  AdminRoutes,
  AdminUserSchema,
  AdminUsersResponseSchema,
  Role,
} from '@panter/contracts';
import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildAdminFactories } from '../src/composition/admin';
import { buildAuthFactories } from '../src/composition/auth';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { createJoseAccessTokenSigner } from '../src/modules/auth/infrastructure/jose-access-tokens';
import { MemoryStaffRoleRepository } from './support/admin-fakes';
import { MemoryUserRepository } from './support/auth-fakes';
import { testKeys, type TestKeys } from './support/jwt-keys';

let keys: TestKeys;
beforeAll(async () => {
  keys = await testKeys();
});

const testEnv = (): Env => ({ ...env, JWT_PUBLIC_KEY: keys.publicKeyPem });

interface ErrorJson {
  error: { code: string; message: string };
}

function setup() {
  const repo = new MemoryStaffRoleRepository();
  const admin = repo.add('admin@panter.test', [Role.PASSENGER, Role.ADMIN]);
  const app = createApp({
    auth: buildAuthFactories({ users: () => new MemoryUserRepository() }),
    admin: buildAdminFactories({ repo: () => repo }),
  });
  async function tokenFor(userId: string, roles: Role[]) {
    const signer = createJoseAccessTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: 'k' });
    return (await signer.sign({ userId, roles, activeMode: 'passenger' })).token;
  }
  async function call(
    method: string,
    path: string,
    options: { body?: unknown; as?: { id: string; roles: Role[] } } = {},
  ) {
    const who = options.as ?? { id: admin.id, roles: [Role.PASSENGER, Role.ADMIN] };
    const headers: Record<string, string> = {
      authorization: `Bearer ${await tokenFor(who.id, who.roles)}`,
    };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    return app.request(
      path,
      {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      testEnv(),
    );
  }
  return { repo, admin, call };
}

async function codeOf(res: Response) {
  return [res.status, (await res.json<ErrorJson>()).error.code];
}

describe('GET /admin/users', () => {
  it('lista con búsqueda y cursor (AdminUsersResponse)', async () => {
    const { repo, call } = setup();
    for (let i = 0; i < 3; i++) repo.add(`ana${i}@villagarzon.test`);
    const res = await call('GET', `${AdminRoutes.USERS}?q=ANA&limit=2`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const page = AdminUsersResponseSchema.parse(await res.json());
    expect(page.items).toHaveLength(2);
    const next = AdminUsersResponseSchema.parse(
      await (
        await call(
          'GET',
          `${AdminRoutes.USERS}?q=ana&limit=2&cursor=${encodeURIComponent(page.nextCursor!)}`,
        )
      ).json(),
    );
    expect(next.items.map((u) => u.email)).toEqual(['ana0@villagarzon.test']);
    expect(next.nextCursor).toBeNull();
  });

  it('límite fuera de rango o cursor inválido → 400', async () => {
    const { call } = setup();
    expect(await codeOf(await call('GET', `${AdminRoutes.USERS}?limit=500`))).toEqual([
      400,
      'VALIDATION_ERROR',
    ]);
    expect(await codeOf(await call('GET', `${AdminRoutes.USERS}?cursor=xx`))).toEqual([
      400,
      'VALIDATION_ERROR',
    ]);
  });

  it('solo ADMIN: otro rol → 403 FORBIDDEN; sin token → 401', async () => {
    const { call, repo } = setup();
    const dispatcher = repo.add('d@panter.test', [Role.DISPATCHER]);
    const res = await call('GET', AdminRoutes.USERS, {
      as: { id: dispatcher.id, roles: [Role.DISPATCHER] },
    });
    expect(await codeOf(res)).toEqual([403, 'FORBIDDEN']);
    const anon = await exports.default.fetch(`https://api.test${AdminRoutes.USERS}`);
    expect(anon.status).toBe(401);
  });
});

describe('POST /admin/users/:userId/roles', () => {
  it('otorga DISPATCHER (AdminUser con grantedBy = correo del admin) y es idempotente', async () => {
    const { repo, call } = setup();
    const target = repo.add('despacho@panter.test');
    const path = adminUserRolesPath(target.id);
    const res = await call('POST', path, { body: { role: 'DISPATCHER' } });
    expect(res.status).toBe(200);
    const user = AdminUserSchema.parse(await res.json());
    expect(user.roles.find((r) => r.role === 'DISPATCHER')?.grantedBy).toBe('admin@panter.test');
    expect((await call('POST', path, { body: { role: 'DISPATCHER' } })).status).toBe(200);
    expect(repo.audit).toHaveLength(1);
  });

  it('PASSENGER o DRIVER → 400 ROLE_NOT_GRANTABLE; rol inexistente → 400 VALIDATION_ERROR', async () => {
    const { repo, call } = setup();
    const target = repo.add('x@panter.test');
    const path = adminUserRolesPath(target.id);
    expect(await codeOf(await call('POST', path, { body: { role: 'DRIVER' } }))).toEqual([
      400,
      'ROLE_NOT_GRANTABLE',
    ]);
    expect(await codeOf(await call('POST', path, { body: { role: 'ROOT' } }))).toEqual([
      400,
      'VALIDATION_ERROR',
    ]);
  });

  it('usuario inexistente → 404; userId que no es UUID → 400', async () => {
    const { call } = setup();
    const missing = adminUserRolesPath('00000000-0000-4000-8000-999999999999');
    expect(await codeOf(await call('POST', missing, { body: { role: 'ADMIN' } }))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    const bad = await call('POST', '/admin/users/abc/roles', { body: { role: 'ADMIN' } });
    expect(bad.status).toBe(400);
  });

  it('token con ADMIN pero sin ADMIN en la base de datos → 403', async () => {
    const { repo, call } = setup();
    const former = repo.add('ex-admin@panter.test', [Role.PASSENGER]);
    const target = repo.add('x@panter.test');
    const res = await call('POST', adminUserRolesPath(target.id), {
      body: { role: 'ADMIN' },
      as: { id: former.id, roles: [Role.ADMIN] },
    });
    expect(await codeOf(res)).toEqual([403, 'FORBIDDEN']);
  });
});

describe('DELETE /admin/users/:userId/roles/:role', () => {
  it('retira TOUR_OPERATOR', async () => {
    const { repo, call } = setup();
    const target = repo.add('op@panter.test', [Role.PASSENGER, Role.TOUR_OPERATOR]);
    const res = await call('DELETE', adminUserRolesPath(target.id, Role.TOUR_OPERATOR));
    expect(res.status).toBe(200);
    expect(AdminUserSchema.parse(await res.json()).roles.map((r) => r.role)).toEqual(['PASSENGER']);
  });

  it('quitarse el propio ADMIN → 409 CANNOT_REVOKE_OWN_ADMIN; PASSENGER → 400', async () => {
    const { admin, call } = setup();
    expect(await codeOf(await call('DELETE', adminUserRolesPath(admin.id, Role.ADMIN)))).toEqual([
      409,
      'CANNOT_REVOKE_OWN_ADMIN',
    ]);
    expect(
      await codeOf(await call('DELETE', adminUserRolesPath(admin.id, Role.PASSENGER))),
    ).toEqual([400, 'ROLE_NOT_GRANTABLE']);
    expect((await call('DELETE', `/admin/users/${admin.id}/roles/ROOT`)).status).toBe(400);
  });
});

describe('OpenAPI', () => {
  it('registra las rutas de administración con bearerAuth', async () => {
    const res = await exports.default.fetch('https://api.test/openapi.json');
    const doc = await res.json<{
      paths: Record<string, Record<string, { security?: unknown; responses: object }>>;
    }>();
    expect(doc.paths['/admin/users']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/admin/users/{userId}/roles']?.post?.responses).toHaveProperty('404');
    expect(doc.paths['/admin/users/{userId}/roles/{role}']?.delete?.responses).toHaveProperty(
      '409',
    );
  });
});
