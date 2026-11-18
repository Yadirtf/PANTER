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
});
