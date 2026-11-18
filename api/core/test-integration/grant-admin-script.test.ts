// `pnpm db:grant-admin <correo>` (scripts/grant-admin.ts) contra PostgreSQL real. Requiere
// DATABASE_URL con las migraciones aplicadas; sin ella se omite.
import { Role } from '@panter/contracts';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import * as schema from '../src/shared/infrastructure/db/schema';

const url = process.env.DATABASE_URL;
const script = resolve(import.meta.dirname, '../scripts/grant-admin.ts');

function grantAdmin(arg: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(process.execPath, arg === undefined ? [script] : [script, arg], {
    encoding: 'utf8',
    env,
  });
  return { status: result.status, out: result.stdout + result.stderr };
}

describe.skipIf(!url)('scripts/grant-admin.ts (integración)', () => {
  const client = postgres(url ?? '', { max: 2, onnotice: () => {} });
  const db = drizzle({ client, schema });
  const run = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];

  afterAll(async () => {
    if (ids.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, ids));
    await client.end();
  });

  it('otorga ADMIN a partir del correo (sin distinguir mayúsculas), audita y es idempotente', async () => {
    const email = `it-${run}-duena@panter.test`;
    const [row] = await db.insert(schema.users).values({ email }).returning();
    ids.push(row!.id);
    await db.insert(schema.userRoles).values({ userId: row!.id, role: Role.PASSENGER });

    const first = grantAdmin(`  ${email.toUpperCase()} `);
    expect(first.out).toContain('ahora tiene el rol ADMIN');
    expect(first.status).toBe(0);

    const second = grantAdmin(email);
    expect(second.out).toContain('ya tenía el rol ADMIN');
    expect(second.status).toBe(0);

    const roles = await db
      .select({ role: schema.userRoles.role, grantedBy: schema.userRoles.grantedBy })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, row!.id));
    expect(roles).toEqual(
      expect.arrayContaining([
        { role: Role.PASSENGER, grantedBy: null },
        { role: Role.ADMIN, grantedBy: null },
      ]),
    );
    const audit = await db
      .select({ actorId: schema.roleAudit.actorId, action: schema.roleAudit.action })
      .from(schema.roleAudit)
      .where(and(eq(schema.roleAudit.userId, row!.id), eq(schema.roleAudit.role, Role.ADMIN)));
    expect(audit).toEqual([{ actorId: null, action: 'grant' }]);
  });

  it('cuenta inexistente → código 1 con instrucciones', () => {
    const result = grantAdmin(`it-${run}-nadie@panter.test`);
    expect(result.status).toBe(1);
    expect(result.out).toContain('Ingresa primero una vez en la app o en la web');
  });

  it('sin correo válido → uso (código 2); sin DATABASE_URL o inválida → código 1', () => {
    expect(grantAdmin(undefined).status).toBe(2);
    expect(grantAdmin('no-es-correo').status).toBe(2);
    const noUrl = { ...process.env, DATABASE_URL: '' };
    expect(grantAdmin('a@b.co', noUrl)).toMatchObject({ status: 1 });
    const bad = grantAdmin('a@b.co', { ...process.env, DATABASE_URL: 'psql postgres://x' });
    expect(bad.status).toBe(1);
    expect(bad.out).toContain('psql');
  });
});
