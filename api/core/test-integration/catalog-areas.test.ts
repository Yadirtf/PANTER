// HU-308: barrios y veredas contra PostgreSQL + PostGIS reales: ST_Covers (el de menor área),
// ST_IsValid con su motivo, nombre único por tipo sin tildes, historial en la misma sentencia,
// recálculo de places.area_id e importación GeoJSON con errores mezclados.
// Requiere DATABASE_URL con las migraciones aplicadas; sin ella se omite.
import { Role, type AreaImportBody, type LatLng } from '@panter/contracts';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeImportAreas } from '../src/modules/catalog/application/areas';
import { makeListCatalogHistory } from '../src/modules/catalog/application/history';
import type { AreaRepository } from '../src/modules/catalog/application/ports';
import {
  AREA_NAME_CONSTRAINT,
  createDrizzleAreaRepository,
} from '../src/modules/catalog/infrastructure/drizzle-area-repository';
import { createDrizzleCatalogChangeRepository } from '../src/modules/catalog/infrastructure/drizzle-catalog-change-repository';
import type { AnyPgDatabase } from '../src/modules/auth/infrastructure/drizzle-user-repository';
import * as schema from '../src/shared/infrastructure/db/schema';

const url = process.env.DATABASE_URL;

/** Rectángulo [sur, oeste] → [norte, este] como anillo abierto. */
const rect = (south: number, west: number, north: number, east: number): LatLng[][] => [
  [
    { lat: south, lng: west },
    { lat: south, lng: east },
    { lat: north, lng: east },
    { lat: north, lng: west },
  ],
];

/** GeoJSON Polygon de un rectángulo (anillo cerrado, [lng, lat]). */
const geoRect = (south: number, west: number, north: number, east: number) => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
});

// Parque principal (semilla 0007): 1.0295, -76.6165. Pozo Azul: 1.045, -76.64.
const PARQUE = { lat: 1.0295, lng: -76.6165 };
const POZO_AZUL = { lat: 1.045, lng: -76.64 };
const CENTRO = rect(1.025, -76.621, 1.034, -76.611);
const VEREDA = rect(1.0, -76.66, 1.06, -76.59);
/** Moño: los bordes se cruzan (ST_IsValid = false, "Self-intersection"). */
const BOWTIE: LatLng[][] = [
  [
    { lat: 1.01, lng: -76.62 },
    { lat: 1.02, lng: -76.61 },
    { lat: 1.01, lng: -76.61 },
    { lat: 1.02, lng: -76.62 },
  ],
];

describe.skipIf(!url)('barrios y veredas (integración)', () => {
  const client = postgres(url ?? '', { max: 4, onnotice: () => {} });
  const db = drizzle({ client, schema });
  const areas = createDrizzleAreaRepository(db);
  const history = makeListCatalogHistory({
    changes: createDrizzleCatalogChangeRepository(db),
    entity: 'AREA',
  });
  const run = crypto.randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const areaIds: string[] = [];
  let admin = '';
  let passenger = '';
  let barrioId = '';
  let veredaId = '';

  async function user(name: string, roles: Role[]) {
    const [row] = await db
      .insert(schema.users)
      .values({ email: `it-areas-${run}-${name}@panter.test` })
      .returning();
    userIds.push(row!.id);
    await db.insert(schema.userRoles).values(roles.map((role) => ({ userId: row!.id, role })));
    return row!.id;
  }

  const placeArea = async (slug: string) =>
    (
      await db
        .select({ areaId: schema.places.areaId })
        .from(schema.places)
        .where(eq(schema.places.slug, slug))
    )[0]?.areaId ?? null;

  const draft = (name: string, kind: 'BARRIO' | 'VEREDA', polygon: LatLng[][]) => ({
    name,
    nameSearch: name
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase(),
    kind,
    polygon,
    source: 'Prueba de integración',
  });

  beforeAll(async () => {
    admin = await user('admin', [Role.PASSENGER, Role.ADMIN]);
    passenger = await user('pasajero', [Role.PASSENGER]);
  });

  afterAll(async () => {
    const created = await db
      .select({ id: schema.areas.id })
      .from(schema.areas)
      .where(inArray(schema.areas.updatedBy, userIds.length > 0 ? userIds : [crypto.randomUUID()]));
    const ids = [...new Set([...areaIds, ...created.map((r) => r.id)])];
    if (ids.length > 0) {
      await db.delete(schema.catalogChanges).where(inArray(schema.catalogChanges.entityId, ids));
      await db.delete(schema.areas).where(inArray(schema.areas.id, ids));
    }
    if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    await client.end();
  });

  it('crea un barrio: detalle con polígono y centro, historial CREATE y lugares recalculados', async () => {
    const result = await areas.create({
      actorId: admin,
      area: draft(`Centro ${run}`, 'BARRIO', CENTRO),
    });
    expect(result).toMatchObject({
      actorIsAdmin: true,
      exists: true,
      polygonValid: true,
      nameTaken: false,
      changed: true,
    });
    barrioId = result.id!;
    areaIds.push(barrioId);

    const area = await areas.get(barrioId);
    expect(area).toMatchObject({
      id: barrioId,
      name: `Centro ${run}`,
      kind: 'BARRIO',
      active: true,
      source: 'Prueba de integración',
      updatedBy: `it-areas-${run}-admin@panter.test`,
    });
    expect(area!.polygon).toEqual(CENTRO);
    // ST_PointOnSurface: siempre dentro del polígono.
    expect(area!.center.lat).toBeGreaterThan(1.025);
    expect(area!.center.lat).toBeLessThan(1.034);
    expect(area!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(await areas.get(crypto.randomUUID())).toBeNull();

    expect(await placeArea('parque-principal')).toBe(barrioId);
    const page = await history(barrioId, { limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      entity: 'AREA',
      entityId: barrioId,
      action: 'CREATE',
      before: null,
      after: { name: `Centro ${run}`, kind: 'BARRIO', active: true, polygon: CENTRO },
      changedBy: `it-areas-${run}-admin@panter.test`,
    });
  });

  it('locate con ST_Covers: si se solapan gana el de menor área; fuera de todos → null', async () => {
    const result = await areas.create({
      actorId: admin,
      area: draft(`Vereda ${run}`, 'VEREDA', VEREDA),
    });
    veredaId = result.id!;
    areaIds.push(veredaId);

    expect((await areas.locate(PARQUE))?.id).toBe(barrioId);
    expect((await areas.locate(POZO_AZUL))?.id).toBe(veredaId);
    // El borde cuenta como dentro (ST_Covers, no ST_Contains). En geography los bordes son arcos
    // de círculo máximo: se prueba sobre un meridiano (borde oeste), que sí es uno.
    expect((await areas.locate({ lat: 1.03, lng: -76.621 }))?.id).toBe(barrioId);
    expect(await areas.locate({ lat: 0.9789, lng: -76.6053 })).toBeNull();
    // La vereda más grande no le quita el parque al barrio; Pozo Azul queda en la vereda.
    expect(await placeArea('parque-principal')).toBe(barrioId);
    expect(await placeArea('pozo-azul')).toBe(veredaId);
  });

  it('lista sin polígono, con búsqueda sin tildes, por tipo y con inactivos', async () => {
    const all = await areas.list({ search: `centro ${run}`, includeInactive: false });
    expect(all).toEqual([{ id: barrioId, name: `Centro ${run}`, kind: 'BARRIO', active: true }]);
    expect(await areas.list({ search: run, kind: 'VEREDA', includeInactive: false })).toEqual([
      { id: veredaId, name: `Vereda ${run}`, kind: 'VEREDA', active: true },
    ]);
  });

  it('nombre único por tipo sin tildes ni mayúsculas; en otro tipo sí se puede', async () => {
    const dup = await areas.create({
      actorId: admin,
      area: draft(`CENTRÓ ${run}`, 'BARRIO', CENTRO),
    });
    expect(dup).toMatchObject({ nameTaken: true, changed: false, id: null });
    const other = await areas.create({
      actorId: admin,
      area: draft(`Centro ${run}`, 'VEREDA', rect(1.1, -76.7, 1.11, -76.69)),
    });
    expect(other).toMatchObject({ nameTaken: false, changed: true });
    areaIds.push(other.id!);
    // Renombrar la vereda a un nombre ya usado por otra vereda → nameTaken, sin cambios.
    const rename = await areas.update({
      id: veredaId,
      actorId: admin,
      patch: { name: `Centro ${run}`, nameSearch: `centro ${run}` },
    });
    expect(rename).toMatchObject({ nameTaken: true, changed: false });
  });

  it('polígono inválido → ST_IsValidReason; quien ya no es ADMIN no escribe', async () => {
    const bad = await areas.create({
      actorId: admin,
      area: draft(`Moño ${run}`, 'BARRIO', BOWTIE),
    });
    expect(bad).toMatchObject({ polygonValid: false, changed: false, id: null });
    expect(bad.polygonReason).toMatch(/Self-intersection/i);
    const badUpdate = await areas.update({
      id: barrioId,
      actorId: admin,
      patch: { polygon: BOWTIE },
    });
    expect(badUpdate).toMatchObject({ polygonValid: false, changed: false });

    const notAdmin = await areas.create({
      actorId: passenger,
      area: draft(`Intruso ${run}`, 'BARRIO', CENTRO),
    });
    expect(notAdmin).toMatchObject({ actorIsAdmin: false, changed: false, nameTaken: false });
    expect(await areas.list({ search: `intruso ${run}`, includeInactive: true })).toEqual([]);
  });

  it('editar el polígono recalcula area_id; sin cambios no hay historial; desactivar', async () => {
    // El barrio se mueve al norte: el parque queda solo en la vereda.
    const moved = rect(1.035, -76.621, 1.04, -76.611);
    const result = await areas.update({ id: barrioId, actorId: admin, patch: { polygon: moved } });
    expect(result).toMatchObject({ exists: true, changed: true, polygonValid: true });
    expect(await placeArea('parque-principal')).toBe(veredaId);

    const same = await areas.update({ id: barrioId, actorId: admin, patch: { polygon: moved } });
    expect(same.changed).toBe(false);

    // Volver al polígono original devuelve el parque al barrio.
    await areas.update({ id: barrioId, actorId: admin, patch: { polygon: CENTRO } });
    expect(await placeArea('parque-principal')).toBe(barrioId);

    // Desactivar: deja de ubicarse y sus lugares pasan a la vereda.
    const off = await areas.update({
      id: barrioId,
      actorId: admin,
      patch: { active: false, source: null },
    });
    expect(off.changed).toBe(true);
    expect((await areas.locate(PARQUE))?.id).toBe(veredaId);
    expect(await placeArea('parque-principal')).toBe(veredaId);
    expect(
      await areas.list({ search: `centro ${run}`, kind: 'BARRIO', includeInactive: false }),
    ).toEqual([]);
    expect(
      await areas.list({ search: `centro ${run}`, kind: 'BARRIO', includeInactive: true }),
    ).toEqual([{ id: barrioId, name: `Centro ${run}`, kind: 'BARRIO', active: false }]);
    expect((await areas.get(barrioId))!.source).toBeNull();

    await areas.update({ id: barrioId, actorId: admin, patch: { active: true } });
    expect(await placeArea('parque-principal')).toBe(barrioId);

    expect(
      await areas.update({ id: crypto.randomUUID(), actorId: admin, patch: { active: false } }),
    ).toMatchObject({ exists: false, changed: false });

    // Historial: CREATE + 3 cambios de polígono o estado = 5 entradas (la repetida no cuenta).
    const first = await history(barrioId, { limit: 2 });
    expect(first.items.map((i) => i.action)).toEqual(['UPDATE', 'UPDATE']);
    expect(first.items[0]).toMatchObject({ before: { active: false }, after: { active: true } });
    expect(first.nextCursor).not.toBeNull();
    const second = await history(barrioId, { limit: 2, cursor: first.nextCursor! });
    const third = await history(barrioId, { limit: 2, cursor: second.nextCursor! });
    expect([...first.items, ...second.items, ...third.items].map((i) => i.action)).toEqual([
      'UPDATE',
      'UPDATE',
      'UPDATE',
      'UPDATE',
      'CREATE',
    ]);
    expect(third.nextCursor).toBeNull();
    expect(second.items[0]).toMatchObject({
      before: { polygon: moved },
      after: { polygon: CENTRO },
    });
  });

  it('importación GeoJSON con errores mezclados: vista previa y luego upsert con IMPORT', async () => {
    const importAreas = makeImportAreas({ areas });
    const body: AreaImportBody = {
      geojson: {
        type: 'FeatureCollection',
        features: [
          // 0: nueva, con el nombre en "NOMBRE" (mayúsculas, como lo exporta ArcGIS).
          {
            type: 'Feature',
            properties: { NOMBRE: `El Recreo ${run}`, tipo: 'barrio' },
            geometry: geoRect(1.026, -76.63, 1.03, -76.625),
          },
          // 1: reemplaza la vereda existente (mismo tipo y nombre sin tildes), MultiPolygon de 1 parte.
          {
            type: 'Feature',
            properties: { nombre: `VEREDA ${run}`, tipo: 'Vereda' },
            geometry: {
              type: 'MultiPolygon',
              coordinates: [geoRect(1.0, -76.66, 1.05, -76.6).coordinates],
            },
          },
          // 2: bordes cruzados (PostGIS).
          {
            type: 'Feature',
            properties: { nombre: `Moño ${run}` },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-76.62, 1.01],
                  [-76.61, 1.02],
                  [-76.61, 1.01],
                  [-76.62, 1.02],
                  [-76.62, 1.01],
                ],
              ],
            },
          },
          // 3: fuera del área de servicio (Bogotá).
          {
            type: 'Feature',
            properties: { nombre: `Bogotá ${run}` },
            geometry: geoRect(4.6, -74.1, 4.7, -74.0),
          },
          // 4: repetida dentro del archivo.
          {
            type: 'Feature',
            properties: { nombre: `el recreo ${run}`, tipo: 'BARRIO' },
            geometry: geoRect(1.026, -76.63, 1.03, -76.625),
          },
        ],
      },
      kindProperty: 'tipo',
      defaultKind: 'BARRIO',
      source: 'Alcaldía de Villagarzón – POT (prueba)',
      dryRun: true,
    };
    const actor = { userId: admin, roles: [Role.ADMIN], activeMode: 'passenger' as const };

    const preview = await importAreas(actor, body);
    expect(preview.saved).toBe(0);
    expect(preview.valid.map((v) => [v.index, v.kind, v.replacesExisting])).toEqual([
      [0, 'BARRIO', false],
      [1, 'VEREDA', true],
    ]);
    expect(preview.errors.map((e) => e.index)).toEqual([2, 3, 4]);
    expect(preview.errors[0]!.reason).toMatch(/Self-intersection/);
    expect(preview.errors[1]!.reason).toMatch(/área de servicio/);
    expect(preview.errors[2]!.reason).toMatch(/repetido en el archivo/);
    // dryRun no guarda nada.
    expect(await areas.list({ search: `el recreo ${run}`, includeInactive: true })).toEqual([]);

    const saved = await importAreas(actor, { ...body, dryRun: false });
    expect(saved.saved).toBe(2);
    const [recreo] = await areas.list({ search: `el recreo ${run}`, includeInactive: true });
    expect(recreo).toMatchObject({ kind: 'BARRIO', active: true });
    areaIds.push(recreo!.id);
    const vereda = await areas.get(veredaId);
    expect(vereda).toMatchObject({
      name: `VEREDA ${run}`,
      source: 'Alcaldía de Villagarzón – POT (prueba)',
    });
    expect(vereda!.polygon).toEqual(rect(1.0, -76.66, 1.05, -76.6));
    // El nuevo límite de la vereda sigue cubriendo Pozo Azul (recalculado en el mismo upsert).
    expect(await placeArea('pozo-azul')).toBe(veredaId);

    const veredaHistory = await history(veredaId, { limit: 1 });
    expect(veredaHistory.items[0]).toMatchObject({
      action: 'IMPORT',
      before: { name: `Vereda ${run}` },
      after: { name: `VEREDA ${run}` },
    });
    const recreoHistory = await history(recreo!.id, { limit: 5 });
    expect(recreoHistory.items).toMatchObject([{ action: 'IMPORT', before: null }]);

    // Un actor que ya no es ADMIN no importa nada.
    const denied = await areas.importAreas({
      actorId: passenger,
      source: null,
      items: [draft(`Intruso ${run}`, 'BARRIO', CENTRO)],
    });
    expect(denied).toEqual({ actorIsAdmin: false, saved: 0 });
  });

  it('un choque simultáneo por el nombre (23505) se informa como nameTaken', async () => {
    const racing = {
      execute: () =>
        Promise.reject(
          Object.assign(new Error('duplicate key'), {
            cause: { code: '23505', constraint_name: AREA_NAME_CONSTRAINT },
          }),
        ),
    } as unknown as AnyPgDatabase;
    const repo: AreaRepository = createDrizzleAreaRepository(racing);
    expect(
      await repo.create({ actorId: admin, area: draft(`X ${run}`, 'BARRIO', CENTRO) }),
    ).toMatchObject({ nameTaken: true, changed: false });
    const other = createDrizzleAreaRepository({
      execute: () => Promise.reject(new Error('conexión')),
    } as unknown as AnyPgDatabase);
    await expect(
      other.update({ id: barrioId, actorId: admin, patch: { active: true } }),
    ).rejects.toThrow('conexión');
  });
});
