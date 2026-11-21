// HU-308: casos de uso de barrios y veredas con el repositorio en memoria.
import { ApiErrorCode, Role } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  makeCreateArea,
  makeGetArea,
  makeImportAreas,
  makeListAreas,
  makeUpdateArea,
} from '../../../src/modules/catalog/application/areas';
import type { AppError } from '../../../src/shared/errors/app-error';
import { CENTRO_POLYGON, MemoryAreaRepository } from '../../support/catalog-fakes';

const actor = { userId: 'admin', roles: [Role.ADMIN], activeMode: 'passenger' as const };

function setup() {
  const repo = new MemoryAreaRepository();
  repo.admins.add('admin');
  const centro = repo.seed('Centro', 'BARRIO', CENTRO_POLYGON);
  let changes = 0;
  return { repo, centro, onChange: () => changes++, changes: () => changes };
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error('se esperaba un error');
}

describe('casos de uso de barrios y veredas', () => {
  it('listar: q sin letras no filtra; includeInactive solo ADMIN', async () => {
    const { repo } = setup();
    const list = makeListAreas({ areas: repo });
    expect(
      (await list({ q: '¿?', includeInactive: false }, { isAdmin: false })).items,
    ).toHaveLength(1);
    const err = await failure(list({ includeInactive: true }, { isAdmin: false }));
    expect([err.status, err.code]).toEqual([403, ApiErrorCode.FORBIDDEN]);
  });

  it('detalle: el ADMIN ve el correo de quien editó', async () => {
    const { repo, centro } = setup();
    repo.rows.get(centro)!.updatedBy = 'admin@panter.test';
    const get = makeGetArea({ areas: repo });
    expect((await get(centro, { isAdmin: true })).updatedBy).toBe('admin@panter.test');
    expect((await get(centro, { isAdmin: false })).updatedBy).toBeNull();
  });

  it('crear y editar avisan el cambio; sin cambios no; sin onChange también funciona', async () => {
    const { repo, centro, onChange, changes } = setup();
    const update = makeUpdateArea({ areas: repo, onChange });
    await update(actor, centro, { name: 'Centro' });
    expect(changes()).toBe(0);
    await update(actor, centro, { kind: 'VEREDA', source: '  ' });
    expect(changes()).toBe(1);
    expect(repo.rows.get(centro)).toMatchObject({ kind: 'VEREDA', source: null });

    const create = makeCreateArea({ areas: repo });
    const created = await create(actor, {
      name: 'Nuevo',
      kind: 'BARRIO',
      polygon: CENTRO_POLYGON,
    });
    expect(created.source).toBeNull();
    // Si el repositorio no devuelve lo guardado (borrado en paralelo) → 404.
    repo.get = async () => null;
    expect(
      (await failure(create(actor, { name: 'Otro', kind: 'BARRIO', polygon: CENTRO_POLYGON })))
        .status,
    ).toBe(404);
    expect((await failure(update(actor, centro, { active: false }))).status).toBe(404);
  });

  it('nombre ocupado al editar: el mensaje usa el tipo y nombre actuales si no vienen', async () => {
    const { repo, centro } = setup();
    repo.seed('Otro', 'BARRIO', CENTRO_POLYGON);
    repo.update = async () => ({
      actorIsAdmin: true,
      exists: true,
      polygonValid: true,
      polygonReason: null,
      nameTaken: true,
      id: centro,
      changed: false,
    });
    const err = await failure(makeUpdateArea({ areas: repo })(actor, centro, { active: true }));
    expect(err.message).toBe(
      'Ya existe un barrio llamado «Centro». Usa otro nombre o edita el existente.',
    );
    repo.get = async () => null;
    const blind = await failure(makeUpdateArea({ areas: repo })(actor, centro, { active: true }));
    expect(blind.message).toContain('un barrio llamado «»');
  });

  it('polígono rechazado por PostGIS sin motivo', async () => {
    const { repo, centro } = setup();
    repo.update = async () => ({
      actorIsAdmin: true,
      exists: true,
      polygonValid: false,
      polygonReason: null,
      nameTaken: false,
      id: centro,
      changed: false,
    });
    const err = await failure(makeUpdateArea({ areas: repo })(actor, centro, { active: true }));
    expect(err.details).toMatchObject({ reason: expect.stringContaining('geometría inválida') });
  });

  it('importar sin features válidas no consulta PostGIS ni guarda; sin resultado de PostGIS = inválida', async () => {
    const { repo } = setup();
    let checks = 0;
    const original = repo.checkImport.bind(repo);
    repo.checkImport = async (items) => (checks++, original(items));
    const importAreas = makeImportAreas({ areas: repo });
    const empty = await importAreas(actor, {
      geojson: { type: 'FeatureCollection', features: ['x'] },
      defaultKind: 'BARRIO',
      dryRun: false,
    });
    expect(empty).toMatchObject({ saved: 0, valid: [], errors: [{ index: 0 }] });
    expect(checks).toBe(0);

    repo.checkImport = async () => [];
    const missing = await importAreas(actor, {
      geojson: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Sin respuesta' },
            geometry: {
              type: 'Polygon',
              coordinates: [CENTRO_POLYGON[0]!.map((p) => [p.lng, p.lat])],
            },
          },
        ],
      },
      defaultKind: 'BARRIO',
      dryRun: false,
      source: '  ',
    });
    expect(missing.errors[0]!.reason).toContain('geometría inválida');
    expect(missing.saved).toBe(0);
  });
});
