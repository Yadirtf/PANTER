// Repositorio del solicitante (HU-201) contra PostgreSQL + PostGIS real. Requiere DATABASE_URL
// con las migraciones aplicadas; sin ella se omite.
import { Role } from '@panter/contracts';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createDrizzleDriverRepository } from '../src/modules/drivers/infrastructure/drizzle-driver-repository';
import type { Vehicle } from '../src/modules/drivers/domain/driver-profile';
import * as schema from '../src/shared/infrastructure/db/schema';

const url = process.env.DATABASE_URL;

/** Placa única por corrida: 3 letras al azar + números. */
function plates() {
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const pick = () => letters[Math.floor(Math.random() * letters.length)]!;
  const prefix = () => pick() + pick() + pick();
  return {
    car: () => `${prefix()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`,
    moto: () => `${prefix()}${String(Math.floor(Math.random() * 100)).padStart(2, '0')}${pick()}`,
  };
}

describe.skipIf(!url)('DrizzleDriverRepository (integración)', () => {
  const client = postgres(url ?? '', { max: 4, onnotice: () => {} });
  const db = drizzle({ client, schema });
  const repo = createDrizzleDriverRepository(db);
  const run = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];
  const plate = plates();

  async function user(name: string) {
    const [row] = await db
      .insert(schema.users)
      .values({ email: `it-drv-${run}-${name}@panter.test` })
      .returning();
    ids.push(row!.id);
    await db.insert(schema.userRoles).values({ userId: row!.id, role: Role.PASSENGER });
    return row!;
  }

  const moto = (over: Partial<Vehicle> = {}): Vehicle => ({
    vehicleType: 'MOTOTAXI',
    plate: plate.moto(),
    brand: 'Bajaj',
    model: 'Boxer CT100',
    color: 'Rojo',
    year: 2022,
    ...over,
  });

  afterAll(async () => {
    if (ids.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, ids));
    await client.end();
  });

  it('crea PENDING/OFFLINE, no otorga DRIVER y no duplica el perfil', async () => {
    const u = await user('crea');
    const vehicle = moto();
    const created = await repo.create(u.id, vehicle);
    expect(created).toMatchObject({
      ok: true,
      profile: {
        userId: u.id,
        vehicle,
        verificationStatus: 'PENDING',
        availability: 'OFFLINE',
        rejectionReason: null,
        reviewedAt: null,
        reviewedBy: null,
      },
    });
    if (created.ok) expect(created.profile.appliedAt).toMatch(/Z$/);
    expect(await repo.create(u.id, moto())).toEqual({ ok: false, reason: 'exists' });
    const roles = await db
      .select({ role: schema.userRoles.role })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, u.id));
    expect(roles).toEqual([{ role: 'PASSENGER' }]);
    expect(await repo.findProfile(u.id)).toMatchObject({ vehicle });
    expect(await repo.listDocuments(u.id)).toEqual([]);
  });

  it('traduce la restricción única de la placa a plate_taken (también al reenviar)', async () => {
    const a = await user('placa-a');
    const b = await user('placa-b');
    const taken = plate.car();
    expect((await repo.create(a.id, moto({ vehicleType: 'TAXI', plate: taken }))).ok).toBe(true);
    expect(await repo.create(b.id, moto({ vehicleType: 'TAXI', plate: taken }))).toEqual({
      ok: false,
      reason: 'plate_taken',
    });
    expect((await repo.create(b.id, moto())).ok).toBe(true);
    await db
      .update(schema.driverProfiles)
      .set({ verificationStatus: 'REJECTED' })
      .where(eq(schema.driverProfiles.userId, b.id));
    expect(await repo.resubmit(b.id, moto({ vehicleType: 'TAXI', plate: taken }))).toEqual({
      ok: false,
      reason: 'plate_taken',
    });
  });

  it('otros errores de la base de datos no se esconden', async () => {
    // Cuenta inexistente: viola la llave foránea (23503), no la placa.
    await expect(repo.create(crypto.randomUUID(), moto())).rejects.toThrow();
  });

  it('reenvío: solo desde REJECTED, limpia la revisión y vuelve a PENDING', async () => {
    const u = await user('reenvio');
    const admin = await user('reenvio-admin');
    await repo.create(u.id, moto());
    expect(await repo.resubmit(u.id, moto())).toEqual({ ok: false, reason: 'not_rejected' });
    await db
      .update(schema.driverProfiles)
      .set({
        verificationStatus: 'REJECTED',
        rejectionReason: 'Las fotos de la tarjeta de propiedad no se leen',
        reviewedAt: new Date('2026-11-18T12:00:00Z'),
        reviewedBy: admin.id,
        appliedAt: new Date('2026-11-01T12:00:00Z'),
      })
      .where(eq(schema.driverProfiles.userId, u.id));
    const fixed = moto({ color: 'Negro' });
    const result = await repo.resubmit(u.id, fixed);
    expect(result).toMatchObject({
      ok: true,
      profile: {
        vehicle: fixed,
        verificationStatus: 'PENDING',
        rejectionReason: null,
        reviewedAt: null,
        reviewedBy: null,
      },
    });
    if (result.ok) expect(result.profile.appliedAt > '2026-11-02').toBe(true);
    expect(await repo.resubmit(crypto.randomUUID(), fixed)).toEqual({
      ok: false,
      reason: 'not_rejected',
    });
  });

  it('modo conductor solo con APPROVED; setUnavailable deja OFFLINE', async () => {
    const u = await user('modo');
    expect(await repo.canUseDriverMode(u.id)).toBe(false);
    await repo.create(u.id, moto());
    expect(await repo.canUseDriverMode(u.id)).toBe(false);
    await db
      .update(schema.driverProfiles)
      .set({ verificationStatus: 'APPROVED', availability: 'AVAILABLE' })
      .where(eq(schema.driverProfiles.userId, u.id));
    expect(await repo.canUseDriverMode(u.id)).toBe(true);
    await repo.setUnavailable(u.id);
    expect((await repo.findProfile(u.id))?.availability).toBe('OFFLINE');
    await repo.setUnavailable(u.id);
    await db
      .update(schema.driverProfiles)
      .set({ verificationStatus: 'SUSPENDED' })
      .where(eq(schema.driverProfiles.userId, u.id));
    expect(await repo.canUseDriverMode(u.id)).toBe(false);
    // Sin perfil no falla.
    await expect(repo.setUnavailable(crypto.randomUUID())).resolves.toBeUndefined();
  });

  it('lista los documentos del perfil', async () => {
    const u = await user('docs');
    await repo.create(u.id, moto());
    await db.insert(schema.driverDocuments).values({
      userId: u.id,
      type: 'SOAT',
      r2Key: `drivers/${u.id}/SOAT/${crypto.randomUUID()}`,
      contentType: 'image/webp',
      sizeBytes: 1234,
    });
    expect(await repo.listDocuments(u.id)).toMatchObject([
      {
        type: 'SOAT',
        status: 'SUBMITTED',
        contentType: 'image/webp',
        sizeBytes: 1234,
        reviewedAt: null,
      },
    ]);
  });
  it('HU-202: upsert del documento como SUBMITTED, limpia la revisión y respeta el estado', async () => {
    const u = await user('upsert');
    const admin = await user('upsert-admin');
    const key = (n: string) => `drivers/${u.id}/CEDULA/${n}`;
    const input = (n: string) =>
      ({
        userId: u.id,
        type: 'CEDULA',
        r2Key: key(n),
        contentType: 'image/png',
        sizeBytes: 2048,
      }) as const;
    // Sin perfil no escribe (ni rompe la llave foránea).
    expect(await repo.upsertDocument(input('a'))).toBeNull();
    await repo.create(u.id, moto());
    const first = await repo.upsertDocument(input('a'));
    expect(first).toEqual({
      userId: u.id,
      type: 'CEDULA',
      r2Key: key('a'),
      contentType: 'image/png',
      sizeBytes: 2048,
      status: 'SUBMITTED',
      rejectionReason: null,
      uploadedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      reviewedAt: null,
      reviewedBy: null,
    });
    await db
      .update(schema.driverDocuments)
      .set({
        status: 'REJECTED',
        rejectionReason: 'La foto de la cédula está borrosa',
        reviewedAt: new Date(),
        reviewedBy: admin.id,
      })
      .where(eq(schema.driverDocuments.userId, u.id));
    await db
      .update(schema.driverProfiles)
      .set({ verificationStatus: 'REJECTED' })
      .where(eq(schema.driverProfiles.userId, u.id));
    const again = await repo.upsertDocument({
      ...input('b'),
      contentType: 'image/jpeg',
      sizeBytes: 999,
    });
    expect(again).toMatchObject({
      r2Key: key('b'),
      status: 'SUBMITTED',
      sizeBytes: 999,
      contentType: 'image/jpeg',
    });
    const [row] = await db
      .select()
      .from(schema.driverDocuments)
      .where(eq(schema.driverDocuments.userId, u.id));
    expect(row).toMatchObject({
      status: 'SUBMITTED',
      rejectionReason: null,
      reviewedAt: null,
      reviewedBy: null,
    });
    expect(await repo.listDocuments(u.id)).toHaveLength(1);

    for (const status of ['APPROVED', 'SUSPENDED'] as const) {
      await db
        .update(schema.driverProfiles)
        .set({ verificationStatus: status })
        .where(eq(schema.driverProfiles.userId, u.id));
      expect(await repo.upsertDocument(input('c'))).toBeNull();
    }
    expect((await repo.listDocuments(u.id))[0]?.r2Key).toBe(key('b'));
  });
});
