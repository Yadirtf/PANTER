// Revisión por ADMIN (HU-204) contra PostgreSQL + PostGIS real: listado con cursor, decisiones
// en una sola sentencia y la aprobación que otorga DRIVER con auditoría. Requiere DATABASE_URL
// con las migraciones aplicadas; sin ella se omite.
import { REQUIRED_DOCUMENTS, Role, type DocumentType } from '@panter/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createDrizzleDriverReviewRepository } from '../src/modules/drivers/infrastructure/drizzle-driver-review-repository';
import { allowedFrom } from '../src/modules/drivers/domain/driver-status';
import * as schema from '../src/shared/infrastructure/db/schema';

const url = process.env.DATABASE_URL;

const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const plate = () =>
  Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('') +
  String(Math.floor(Math.random() * 1000)).padStart(3, '0');

describe.skipIf(!url)('DrizzleDriverReviewRepository (integración)', () => {
  const client = postgres(url ?? '', { max: 8, onnotice: () => {} });
  const db = drizzle({ client, schema });
  const repo = createDrizzleDriverReviewRepository(db);
  const run = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];

  async function user(
    name: string,
    roles: Role[] = [Role.PASSENGER],
    status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
  ) {
    const [row] = await db
      .insert(schema.users)
      .values({ email: `it-rev-${run}-${name}@panter.test`, fullName: `Prueba ${name}`, status })
      .returning();
    ids.push(row!.id);
    await db.insert(schema.userRoles).values(roles.map((role) => ({ userId: row!.id, role })));
    return row!;
  }

  async function applicant(
    name: string,
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' = 'PENDING',
    appliedAt?: string,
  ) {
    const u = await user(name);
    await db.insert(schema.driverProfiles).values({
      userId: u.id,
      vehicleType: 'TAXI',
      plate: plate(),
      brand: 'Chevrolet',
      model: 'Spark GT',
      color: 'Amarillo',
      year: 2019,
      verificationStatus: status,
      ...(appliedAt ? { appliedAt: sql`${appliedAt}::timestamptz` } : {}),
    });
    return u;
  }

  async function docs(
    userId: string,
    status: 'SUBMITTED' | 'APPROVED',
    types = REQUIRED_DOCUMENTS,
  ) {
    await db.insert(schema.driverDocuments).values(
      types.map((type: DocumentType) => ({
        userId,
        type,
        r2Key: `drivers/${userId}/${type}/${crypto.randomUUID()}`,
        contentType: 'image/jpeg',
        sizeBytes: 1000,
        status,
      })),
    );
  }

  const profileOf = async (id: string) =>
    (await db.select().from(schema.driverProfiles).where(eq(schema.driverProfiles.userId, id)))[0]!;
  const rolesOf = async (id: string) =>
    (
      await db
        .select({ role: schema.userRoles.role, grantedBy: schema.userRoles.grantedBy })
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, id))
    ).sort((a, b) => a.role.localeCompare(b.role));
  const auditOf = (id: string) =>
    db
      .select({
        actorId: schema.roleAudit.actorId,
        role: schema.roleAudit.role,
        action: schema.roleAudit.action,
      })
      .from(schema.roleAudit)
      .where(eq(schema.roleAudit.userId, id));

  afterAll(async () => {
    if (ids.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, ids));
    await client.end();
  });

  it('lista por estado de la más antigua a la más reciente, con cursor estable en el mismo instante', async () => {
    const at = '2001-01-01T12:00:00.123456Z';
    const tag = `cola-${run}`;
    const created = [];
    for (let i = 0; i < 4; i++) created.push((await applicant(`${tag}-${i}`, 'SUSPENDED', at)).id);
    const expected = [...created].sort();
    const seen: string[] = [];
    let after;
    for (let page = 0; page < 10; page++) {
      const result = await repo.list({ status: 'SUSPENDED', limit: 3, after });
      seen.push(...result.items.map((r) => r.profile.userId));
      if (!result.next) break;
      after = result.next;
    }
    // Las de 2001 van primero (más antiguas) y en orden de user_id.
    expect(seen.slice(0, 4)).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);
    expect((await repo.list({ limit: 1 })).items).toHaveLength(1);
  });

  it('find trae documentos, datos de la cuenta y el correo de quien revisó', async () => {
    const admin = await user('admin-find', [Role.PASSENGER, Role.ADMIN]);
    const a = await applicant('find');
    await docs(a.id, 'SUBMITTED', ['CEDULA', 'SOAT']);
    expect(await repo.find(crypto.randomUUID())).toBeNull();
    const before = await repo.find(a.id);
    expect(before).toMatchObject({
      email: a.email,
      fullName: 'Prueba find',
      phone: null,
      reviewedByEmail: null,
      profile: { userId: a.id, verificationStatus: 'PENDING' },
    });
    expect(before?.documents.map((d) => d.type).sort()).toEqual(['CEDULA', 'SOAT']);
    await repo.changeStatus({
      actorId: admin.id,
      userId: a.id,
      from: allowedFrom('reject'),
      to: 'REJECTED',
      reason: 'Falta la licencia',
      setOffline: false,
    });
    expect((await repo.find(a.id))?.reviewedByEmail).toBe(admin.email);
  });

  it('revisa documentos solo con solicitud PENDING/REJECTED y ADMIN activo', async () => {
    const admin = await user('admin-doc', [Role.ADMIN]);
    const fake = await user('no-admin', [Role.DISPATCHER]);
    const a = await applicant('doc');
    await docs(a.id, 'SUBMITTED', ['SOAT']);
    const input = {
      actorId: admin.id,
      userId: a.id,
      type: 'SOAT' as const,
      status: 'REJECTED' as const,
      reason: 'SOAT vencido',
      profileFrom: ['PENDING', 'REJECTED'] as const,
    };
    expect(await repo.reviewDocument({ ...input, actorId: fake.id })).toEqual({
      actorIsAdmin: false,
      changed: false,
    });
    expect(await repo.reviewDocument(input)).toEqual({ actorIsAdmin: true, changed: true });
    const [row] = await db
      .select()
      .from(schema.driverDocuments)
      .where(eq(schema.driverDocuments.userId, a.id));
    expect(row).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'SOAT vencido',
      reviewedBy: admin.id,
    });
    expect(await repo.reviewDocument({ ...input, type: 'CEDULA' })).toMatchObject({
      changed: false,
    });
    await db
      .update(schema.driverProfiles)
      .set({ verificationStatus: 'APPROVED' })
      .where(eq(schema.driverProfiles.userId, a.id));
    expect(await repo.reviewDocument(input)).toMatchObject({ changed: false });
  });

  it('aprobar en una sentencia: APPROVED, DRIVER con granted_by y role_audit; sin los 5 no cambia nada', async () => {
    const admin = await user('admin-ok', [Role.PASSENGER, Role.ADMIN]);
    const a = await applicant('aprobar');
    await docs(a.id, 'APPROVED', REQUIRED_DOCUMENTS.slice(0, 4));
    const input = { actorId: admin.id, userId: a.id, from: allowedFrom('approve') };

    expect(await repo.approve(input)).toEqual({ actorIsAdmin: true, changed: false });
    expect((await profileOf(a.id)).verificationStatus).toBe('PENDING');
    expect((await rolesOf(a.id)).map((r) => r.role)).toEqual(['PASSENGER']);

    await docs(a.id, 'APPROVED', ['TECNOMECANICA']);
    expect(await repo.approve(input)).toEqual({ actorIsAdmin: true, changed: true });
    const profile = await profileOf(a.id);
    expect(profile).toMatchObject({
      verificationStatus: 'APPROVED',
      reviewedBy: admin.id,
      rejectionReason: null,
    });
    expect(profile.reviewedAt).toBeInstanceOf(Date);
    expect(await rolesOf(a.id)).toEqual([
      { role: 'DRIVER', grantedBy: admin.id },
      { role: 'PASSENGER', grantedBy: null },
    ]);
    expect(await auditOf(a.id)).toEqual([{ actorId: admin.id, role: 'DRIVER', action: 'grant' }]);

    // Ya APPROVED: no se aplica otra vez ni se duplica la auditoría.
    expect(await repo.approve(input)).toMatchObject({ changed: false });
    expect(await auditOf(a.id)).toHaveLength(1);
  });

  it('aprobar con un actor que no es ADMIN (o suspendido) no cambia nada', async () => {
    const suspended = await user('admin-susp', [Role.ADMIN], 'SUSPENDED');
    const a = await applicant('aprobar-2');
    await docs(a.id, 'APPROVED');
    expect(
      await repo.approve({ actorId: suspended.id, userId: a.id, from: allowedFrom('approve') }),
    ).toEqual({
      actorIsAdmin: false,
      changed: false,
    });
    expect((await profileOf(a.id)).verificationStatus).toBe('PENDING');
    expect(await auditOf(a.id)).toEqual([]);
  });

  it('dos ADMIN aprueban a la vez: una sola aprobación y un solo registro de auditoría', async () => {
    const one = await user('admin-a', [Role.ADMIN]);
    const two = await user('admin-b', [Role.ADMIN]);
    const a = await applicant('carrera');
    await docs(a.id, 'APPROVED');
    const results = await Promise.all(
      [one, two].map((admin) =>
        repo.approve({ actorId: admin.id, userId: a.id, from: allowedFrom('approve') }),
      ),
    );
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    expect(await auditOf(a.id)).toHaveLength(1);
  });

  it('suspender deja OFFLINE y conserva DRIVER; reactivar vuelve a APPROVED; origen inválido no cambia', async () => {
    const admin = await user('admin-susp-ok', [Role.ADMIN]);
    const a = await applicant('suspender', 'APPROVED');
    await db.insert(schema.userRoles).values({ userId: a.id, role: Role.DRIVER });
    await db
      .update(schema.driverProfiles)
      .set({ availability: 'AVAILABLE' })
      .where(eq(schema.driverProfiles.userId, a.id));
    const base = { actorId: admin.id, userId: a.id };
    expect(
      await repo.changeStatus({
        ...base,
        from: allowedFrom('reinstate'),
        to: 'APPROVED',
        reason: null,
        setOffline: false,
      }),
    ).toEqual({ actorIsAdmin: true, changed: false });
    expect(
      await repo.changeStatus({
        ...base,
        from: allowedFrom('suspend'),
        to: 'SUSPENDED',
        reason: 'Quejas por cobro de más',
        setOffline: true,
      }),
    ).toEqual({ actorIsAdmin: true, changed: true });
    expect(await profileOf(a.id)).toMatchObject({
      verificationStatus: 'SUSPENDED',
      availability: 'OFFLINE',
      rejectionReason: 'Quejas por cobro de más',
    });
    const driverRole = await db
      .select()
      .from(schema.userRoles)
      .where(and(eq(schema.userRoles.userId, a.id), eq(schema.userRoles.role, Role.DRIVER)));
    expect(driverRole).toHaveLength(1);
    expect(
      await repo.changeStatus({
        ...base,
        from: allowedFrom('reinstate'),
        to: 'APPROVED',
        reason: null,
        setOffline: false,
      }),
    ).toMatchObject({ changed: true });
    expect(await profileOf(a.id)).toMatchObject({
      verificationStatus: 'APPROVED',
      availability: 'OFFLINE',
      rejectionReason: null,
    });
  });
});
