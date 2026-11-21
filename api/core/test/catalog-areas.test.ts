// HU-308: /areas y /admin/areas dentro de workerd con repositorios en memoria (el SQL real se
// prueba en test-integration/catalog-areas.test.ts).
import {
  AREA_IMPORT_MAX_FEATURES,
  ApiErrorCode,
  AreaImportResultSchema,
  AreaLocateResponseSchema,
  AreaRoutes,
  AreaSchema,
  AreasResponseSchema,
  CatalogHistoryResponseSchema,
  PLACES,
  Role,
  adminAreaPath,
  areaPath,
} from '@panter/contracts';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildAuthFactories } from '../src/composition/auth';
import { buildAreaFactories } from '../src/composition/catalog';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { createJoseAccessTokenSigner } from '../src/modules/auth/infrastructure/jose-access-tokens';
import { AREA_IMPORT_MAX_BYTES } from '../src/modules/catalog/http/area-routes';
import { CatalogCache } from '../src/modules/catalog/infrastructure/memory-catalog-cache';
import { MemoryUserRepository } from './support/auth-fakes';
import {
  BOWTIE_POLYGON,
  CENTRO_POLYGON,
  MemoryAreaRepository,
  VEREDA_POLYGON,
} from './support/catalog-fakes';
import { testKeys, type TestKeys } from './support/jwt-keys';

let keys: TestKeys;
beforeAll(async () => {
  keys = await testKeys();
});

interface ErrorJson {
  error: { code: string; message: string; details?: unknown };
}

const ADMIN = '11111111-1111-4111-8111-111111111111';
const PASSENGER = '22222222-2222-4222-8222-222222222222';

const toGeo = (polygon: { lat: number; lng: number }[][]) => ({
  type: 'Polygon',
  coordinates: polygon.map((ring) => [...ring, ring[0]!].map((p) => [p.lng, p.lat])),
});

function setup() {
  const repo = new MemoryAreaRepository();
  repo.admins.add(ADMIN);
  repo.emails.set(ADMIN, 'admin@panter.test');
  const centro = repo.seed('Centro', 'BARRIO', CENTRO_POLYGON);
  const vereda = repo.seed('Vereda Alto Guineo', 'VEREDA', VEREDA_POLYGON);
  const viejo = repo.seed('San José Viejo', 'BARRIO', CENTRO_POLYGON, false);
  const cache = new CatalogCache();
  const app = createApp({
    auth: buildAuthFactories({ users: () => new MemoryUserRepository() }),
    areas: buildAreaFactories({ areas: () => repo, changes: () => repo.changes, cache }),
  });
  const testEnv: Env = { ...env, JWT_PUBLIC_KEY: keys.publicKeyPem };

  async function token(userId: string, roles: Role[]) {
    const signer = createJoseAccessTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: 'k' });
    return (await signer.sign({ userId, roles, activeMode: 'passenger' })).token;
  }
  async function call(
    method: string,
    path: string,
    options: { as?: 'admin' | 'passenger' | 'bad'; body?: unknown; raw?: string } = {},
  ) {
    const headers: Record<string, string> = {};
    if (options.as === 'admin') {
      headers.authorization = `Bearer ${await token(ADMIN, [Role.PASSENGER, Role.ADMIN])}`;
    } else if (options.as === 'passenger') {
      headers.authorization = `Bearer ${await token(PASSENGER, [Role.PASSENGER])}`;
    } else if (options.as === 'bad') {
      headers.authorization = 'Bearer no-es-un-jwt';
    }
    let body: string | undefined;
    if (options.raw !== undefined || options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = options.raw ?? JSON.stringify(options.body);
    }
    return app.request(path, { method, headers, body }, testEnv);
  }
  return { repo, cache, call, ids: { centro, vereda, viejo } };
}

describe('GET /areas (público)', () => {
  it('lista sin polígono, busca sin tildes y filtra por tipo', async () => {
    const { call, ids } = setup();
    const res = await call('GET', AreaRoutes.LIST);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    const body = AreasResponseSchema.parse(await res.json());
    expect(body.items).toEqual([
      { id: ids.centro, name: 'Centro', kind: 'BARRIO', active: true },
      { id: ids.vereda, name: 'Vereda Alto Guineo', kind: 'VEREDA', active: true },
    ]);
    expect(body.items[0]).not.toHaveProperty('polygon');

    const search = AreasResponseSchema.parse(await (await call('GET', '/areas?q=GUÍNEO')).json());
    expect(search.items.map((a) => a.id)).toEqual([ids.vereda]);
    const kind = AreasResponseSchema.parse(await (await call('GET', '/areas?kind=BARRIO')).json());
    expect(kind.items.map((a) => a.id)).toEqual([ids.centro]);
    expect((await call('GET', '/areas?kind=CIUDAD')).status).toBe(400);
  });

  it('includeInactive solo con token de ADMIN; "false" es false', async () => {
    const { call, ids } = setup();
    const anon = await call('GET', '/areas?includeInactive=true');
    expect(anon.status).toBe(403);
    expect((await call('GET', '/areas?includeInactive=true', { as: 'passenger' })).status).toBe(
      403,
    );
    expect((await call('GET', '/areas?includeInactive=false')).status).toBe(200);
    const admin = await call('GET', '/areas?includeInactive=1', { as: 'admin' });
    expect(admin.headers.get('Cache-Control')).toBe('no-store');
    const body = AreasResponseSchema.parse(await admin.json());
    expect(body.items.map((a) => a.id)).toContain(ids.viejo);
    expect((await call('GET', AreaRoutes.LIST, { as: 'bad' })).status).toBe(401);
  });
});

describe('GET /areas/locate (público)', () => {
  it('el de menor área que cubre el punto; fuera de todos o del área de servicio → null', async () => {
    const { call, ids, repo } = setup();
    const locate = async (lat: number, lng: number) =>
      AreaLocateResponseSchema.parse(
        await (await call('GET', `${AreaRoutes.LOCATE}?lat=${lat}&lng=${lng}`)).json(),
      ).area;
    expect((await locate(PLACES.VILLAGARZON_CENTER.lat, PLACES.VILLAGARZON_CENTER.lng))?.id).toBe(
      ids.centro,
    );
    expect((await locate(1.045, -76.64))?.id).toBe(ids.vereda);
    expect(await locate(PLACES.AIRPORT_VGZ.lat, PLACES.AIRPORT_VGZ.lng)).toBeNull();
    const reads = repo.reads;
    expect(await locate(4.711, -74.0721)).toBeNull(); // Bogotá: ni consulta
    expect(repo.reads).toBe(reads);
    expect((await call('GET', `${AreaRoutes.LOCATE}?lat=abc&lng=1`)).status).toBe(400);
    expect((await call('GET', `${AreaRoutes.LOCATE}?lat=95&lng=1`)).status).toBe(400);
  });

  it('caché del isolate de 60 s, invalidada al editar', async () => {
    const { call, ids, repo } = setup();
    const url = `${AreaRoutes.LOCATE}?lat=1.0295&lng=-76.6165`;
    await call('GET', url);
    const reads = repo.reads;
    const again = AreaLocateResponseSchema.parse(await (await call('GET', url)).json());
    expect(again.area?.id).toBe(ids.centro);
    expect(repo.reads).toBe(reads);

    // Desactivar el barrio vacía la caché: ahora el punto queda en la vereda.
    const off = await call('PATCH', adminAreaPath(ids.centro), {
      as: 'admin',
      body: { active: false },
    });
    expect(off.status).toBe(200);
    const after = AreaLocateResponseSchema.parse(await (await call('GET', url)).json());
    expect(after.area?.id).toBe(ids.vereda);
  });
});

describe('GET /areas/:id (público)', () => {
  it('polígono y centro; sin el correo de quien editó salvo para ADMIN', async () => {
    const { call, ids } = setup();
    await call('PATCH', adminAreaPath(ids.centro), { as: 'admin', body: { source: 'POT 2024' } });
    const res = await call('GET', areaPath(ids.centro));
    expect(res.status).toBe(200);
    const area = AreaSchema.parse(await res.json());
    expect(area).toMatchObject({ id: ids.centro, polygon: CENTRO_POLYGON, updatedBy: null });
    expect(area.center).toEqual(CENTRO_POLYGON[0]![0]);
    const admin = AreaSchema.parse(
      await (await call('GET', areaPath(ids.centro), { as: 'admin' })).json(),
    );
    expect(admin).toMatchObject({ source: 'POT 2024', updatedBy: 'admin@panter.test' });
  });

  it('desactivado → 404 salvo para ADMIN; id inválido → 400; inexistente → 404', async () => {
    const { call, ids } = setup();
    expect((await call('GET', areaPath(ids.viejo))).status).toBe(404);
    expect((await call('GET', areaPath(ids.viejo), { as: 'admin' })).status).toBe(200);
    expect((await call('GET', areaPath('no-es-uuid'))).status).toBe(400);
    const missing = await call('GET', areaPath(crypto.randomUUID()));
    expect(missing.status).toBe(404);
    expect((await missing.json<ErrorJson>()).error.message).toBe(
      'No encontramos ese barrio o vereda.',
    );
  });
});

describe('/admin/areas', () => {
  const nuevo = {
    name: 'La Libertad',
    kind: 'BARRIO',
    polygon: [
      [
        { lat: 1.026, lng: -76.63 },
        { lat: 1.026, lng: -76.625 },
        { lat: 1.03, lng: -76.625 },
        { lat: 1.03, lng: -76.63 },
      ],
    ],
    source: '  Dibujado por ADMIN  ',
  };

  it('crear: 201 con historial CREATE; solo ADMIN (token y base de datos)', async () => {
    const { call, repo } = setup();
    expect((await call('POST', AreaRoutes.ADMIN_CREATE, { body: nuevo })).status).toBe(401);
    expect(
      (await call('POST', AreaRoutes.ADMIN_CREATE, { as: 'passenger', body: nuevo })).status,
    ).toBe(403);
    const res = await call('POST', AreaRoutes.ADMIN_CREATE, { as: 'admin', body: nuevo });
    expect(res.status).toBe(201);
    const area = AreaSchema.parse(await res.json());
    expect(area).toMatchObject({
      name: 'La Libertad',
      kind: 'BARRIO',
      source: 'Dibujado por ADMIN',
    });
    const history = CatalogHistoryResponseSchema.parse(
      await (await call('GET', adminAreaPath(area.id, true), { as: 'admin' })).json(),
    );
    expect(history.items).toMatchObject([
      { action: 'CREATE', before: null, changedBy: 'admin@panter.test' },
    ]);

    // Le quitaron el rol en la base de datos: su token aún dice ADMIN, pero no puede escribir.
    repo.admins.delete(ADMIN);
    const demoted = await call('POST', AreaRoutes.ADMIN_CREATE, {
      as: 'admin',
      body: { ...nuevo, name: 'Otro' },
    });
    expect(demoted.status).toBe(403);
  });

  it('polígono fuera del área de servicio o inválido → 422 INVALID_POLYGON con el motivo', async () => {
    const { call } = setup();
    const outside = await call('POST', AreaRoutes.ADMIN_CREATE, {
      as: 'admin',
      body: {
        ...nuevo,
        polygon: [
          [
            { lat: 4.6, lng: -74.1 },
            { lat: 4.6, lng: -74.0 },
            { lat: 4.7, lng: -74.0 },
          ],
        ],
      },
    });
    expect(outside.status).toBe(422);
    const outsideBody = await outside.json<ErrorJson>();
    expect(outsideBody.error.code).toBe(ApiErrorCode.INVALID_POLYGON);
    expect(outsideBody.error.details).toMatchObject({
      reason: expect.stringContaining('área de servicio'),
      issues: [{ path: 'polygon.0.0', code: 'outside_service_area' }],
    });

    const bowtie = await call('POST', AreaRoutes.ADMIN_CREATE, {
      as: 'admin',
      body: { ...nuevo, polygon: BOWTIE_POLYGON },
    });
    expect(bowtie.status).toBe(422);
    expect((await bowtie.json<ErrorJson>()).error.details).toMatchObject({
      reason: expect.stringContaining('Self-intersection'),
    });
  });

  it('nombre repetido en el mismo tipo (sin tildes) → 409 AREA_NAME_TAKEN', async () => {
    const { call, ids } = setup();
    const dup = await call('POST', AreaRoutes.ADMIN_CREATE, {
      as: 'admin',
      body: { ...nuevo, name: 'CÉNTRO' },
    });
    expect(dup.status).toBe(409);
    const body = await dup.json<ErrorJson>();
    expect(body.error.code).toBe(ApiErrorCode.AREA_NAME_TAKEN);
    expect(body.error.message).toBe(
      'Ya existe un barrio llamado «CÉNTRO». Usa otro nombre o edita el existente.',
    );
    // Como vereda sí se puede.
    expect(
      (
        await call('POST', AreaRoutes.ADMIN_CREATE, {
          as: 'admin',
          body: { ...nuevo, name: 'Centro', kind: 'VEREDA' },
        })
      ).status,
    ).toBe(201);
    // Renombrar la vereda a "Vereda Centro" no choca; a "Centro" (otra vereda) sí.
    const rename = await call('PATCH', adminAreaPath(ids.vereda), {
      as: 'admin',
      body: { name: 'centro' },
    });
    expect(rename.status).toBe(409);
    expect((await rename.json<ErrorJson>()).error.message).toContain('una vereda llamada «centro»');
    // Sin letras ni números → 400.
    expect(
      (await call('POST', AreaRoutes.ADMIN_CREATE, { as: 'admin', body: { ...nuevo, name: '¿?' } }))
        .status,
    ).toBe(400);
  });

  it('editar: cambios parciales, sin cambios no hay historial, inexistente → 404', async () => {
    const { call, ids } = setup();
    const res = await call('PATCH', adminAreaPath(ids.centro), {
      as: 'admin',
      body: { name: 'Centro Histórico', polygon: CENTRO_POLYGON, source: null },
    });
    expect(res.status).toBe(200);
    expect(AreaSchema.parse(await res.json())).toMatchObject({
      name: 'Centro Histórico',
      kind: 'BARRIO',
      source: null,
    });
    await call('PATCH', adminAreaPath(ids.centro), {
      as: 'admin',
      body: { name: 'Centro Histórico' },
    });
    const history = CatalogHistoryResponseSchema.parse(
      await (await call('GET', adminAreaPath(ids.centro, true), { as: 'admin' })).json(),
    );
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      action: 'UPDATE',
      before: { name: 'Centro' },
      after: { name: 'Centro Histórico' },
    });
    expect(
      (
        await call('PATCH', adminAreaPath(crypto.randomUUID()), {
          as: 'admin',
          body: { active: true },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call('PATCH', adminAreaPath(ids.centro), {
          as: 'admin',
          body: { polygon: BOWTIE_POLYGON },
        })
      ).status,
    ).toBe(422);
  });

  it('historial con cursor; cursor alterado → 400; solo ADMIN', async () => {
    const { call, ids } = setup();
    for (const name of ['Centro 1', 'Centro 2', 'Centro 3']) {
      await call('PATCH', adminAreaPath(ids.centro), { as: 'admin', body: { name } });
    }
    const first = CatalogHistoryResponseSchema.parse(
      await (
        await call('GET', `${adminAreaPath(ids.centro, true)}?limit=2`, { as: 'admin' })
      ).json(),
    );
    expect(first.items.map((i) => i.after?.name)).toEqual(['Centro 3', 'Centro 2']);
    const second = CatalogHistoryResponseSchema.parse(
      await (
        await call('GET', `${adminAreaPath(ids.centro, true)}?limit=2&cursor=${first.nextCursor}`, {
          as: 'admin',
        })
      ).json(),
    );
    expect(second).toMatchObject({ items: [{ after: { name: 'Centro 1' } }], nextCursor: null });
    expect(
      (await call('GET', `${adminAreaPath(ids.centro, true)}?cursor=basura`, { as: 'admin' }))
        .status,
    ).toBe(400);
    expect((await call('GET', adminAreaPath(ids.centro, true), { as: 'passenger' })).status).toBe(
      403,
    );
  });
});

describe('POST /admin/areas/import', () => {
  const features = [
    {
      type: 'Feature',
      properties: { NOMBRE: 'El Recreo', TIPO: 'barrio' },
      geometry: toGeo([
        [
          { lat: 1.026, lng: -76.63 },
          { lat: 1.026, lng: -76.625 },
          { lat: 1.03, lng: -76.625 },
          { lat: 1.03, lng: -76.63 },
        ],
      ]),
    },
    {
      type: 'Feature',
      properties: { nombre: 'centro', tipo: 'BARRIO' },
      geometry: toGeo(CENTRO_POLYGON),
    },
    { type: 'Feature', properties: { nombre: 'Moño' }, geometry: toGeo(BOWTIE_POLYGON) },
    { type: 'Feature', properties: {}, geometry: toGeo(CENTRO_POLYGON) },
  ];

  it('vista previa con errores por índice y luego guarda las válidas', async () => {
    const { call, repo } = setup();
    const body = { geojson: { type: 'FeatureCollection', features }, kindProperty: 'tipo' };
    const preview = await call('POST', AreaRoutes.ADMIN_IMPORT, { as: 'admin', body });
    expect(preview.status).toBe(200);
    const result = AreaImportResultSchema.parse(await preview.json());
    expect(result.dryRun).toBe(true);
    expect(result.saved).toBe(0);
    expect(result.valid.map((v) => [v.index, v.name, v.replacesExisting])).toEqual([
      [0, 'El Recreo', false],
      [1, 'centro', true],
    ]);
    expect(result.errors).toEqual([
      { index: 2, name: 'Moño', reason: expect.stringContaining('Self-intersection') },
      {
        index: 3,
        name: null,
        reason: 'No tiene nombre: agrega la propiedad "name" o "nombre", o indica cuál usar.',
      },
    ]);
    expect(repo.rows.size).toBe(3);

    const saved = AreaImportResultSchema.parse(
      await (
        await call('POST', AreaRoutes.ADMIN_IMPORT, {
          as: 'admin',
          body: { ...body, dryRun: false, source: 'Alcaldía – POT' },
        })
      ).json(),
    );
    expect(saved.saved).toBe(2);
    expect(repo.rows.size).toBe(4);
    expect(repo.changes.items.filter((c) => c.action === 'IMPORT')).toHaveLength(2);
  });

  it('solo ADMIN; más features de las permitidas → 400; cuerpo demasiado grande → 413', async () => {
    const { call, repo } = setup();
    const body = { geojson: { type: 'FeatureCollection', features }, dryRun: false };
    expect((await call('POST', AreaRoutes.ADMIN_IMPORT, { as: 'passenger', body })).status).toBe(
      403,
    );
    const tooMany = await call('POST', AreaRoutes.ADMIN_IMPORT, {
      as: 'admin',
      body: {
        geojson: {
          type: 'FeatureCollection',
          features: Array.from({ length: AREA_IMPORT_MAX_FEATURES + 1 }, () => features[0]),
        },
      },
    });
    expect(tooMany.status).toBe(400);
    const huge = await call('POST', AreaRoutes.ADMIN_IMPORT, {
      as: 'admin',
      raw: JSON.stringify({ geojson: { type: 'FeatureCollection', features } }).replace(
        '"El Recreo"',
        `"${'x'.repeat(AREA_IMPORT_MAX_BYTES)}"`,
      ),
    });
    expect(huge.status).toBe(413);
    expect((await huge.json<ErrorJson>()).error.code).toBe('PAYLOAD_TOO_LARGE');

    // ADMIN en el token pero ya no en la base de datos.
    repo.admins.delete(ADMIN);
    expect((await call('POST', AreaRoutes.ADMIN_IMPORT, { as: 'admin', body })).status).toBe(403);
  });
});
