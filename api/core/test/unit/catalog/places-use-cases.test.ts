// HU-310: reglas de los lugares y casos de uso con el repositorio en memoria.
import { PLACES, Role } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  makeCreatePlace,
  makeListPlaces,
  makeUpdatePlace,
} from '../../../src/modules/catalog/application/places';
import { pickupTooFar, placePointOutside } from '../../../src/modules/catalog/domain/place-policy';
import type { AppError } from '../../../src/shared/errors/app-error';
import { MemoryAreaRepository, MemoryPlaceRepository } from '../../support/catalog-fakes';

const actor = { userId: 'admin', roles: [Role.ADMIN], activeMode: 'passenger' as const };
const body = {
  slug: 'hospital',
  name: 'Hospital de Villagarzón',
  category: 'HEALTH' as const,
  location: PLACES.VILLAGARZON_CENTER,
  verified: false,
};

function setup() {
  const areas = new MemoryAreaRepository();
  areas.admins.add('admin');
  return new MemoryPlaceRepository(areas);
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error('se esperaba un error');
}

describe('reglas de lugares', () => {
  it('puntos fuera del área de servicio y recogida lejana', () => {
    const bogota = { lat: 4.711, lng: -74.07 };
    expect(placePointOutside(PLACES.AIRPORT_VGZ, null)).toBeNull();
    expect(placePointOutside(bogota, null)).toBe('location');
    expect(placePointOutside(PLACES.AIRPORT_VGZ, bogota)).toBe('pickupPoint');
    expect(pickupTooFar(PLACES.AIRPORT_VGZ, null)).toBe(false);
    expect(pickupTooFar(PLACES.AIRPORT_VGZ, { lat: 0.98, lng: -76.6053 })).toBe(false);
    expect(pickupTooFar(PLACES.AIRPORT_VGZ, PLACES.VILLAGARZON_CENTER)).toBe(true);
  });
});

describe('casos de uso de lugares', () => {
  it('listar: q sin letras no filtra; includeInactive solo ADMIN', async () => {
    const places = setup();
    places.seed('parque', 'Parque', PLACES.VILLAGARZON_CENTER);
    const list = makeListPlaces({ places });
    expect(
      (await list({ q: '¿?', includeInactive: false, limit: 50 }, { isAdmin: false })).items,
    ).toHaveLength(1);
    expect(
      (await failure(list({ includeInactive: true, limit: 50 }, { isAdmin: false }))).status,
    ).toBe(403);
  });

  it('crear sin onChange; nombre sin letras → 400; actor ya no ADMIN → 403', async () => {
    const places = setup();
    const create = makeCreatePlace({ places });
    expect(await create(actor, body)).toMatchObject({ slug: 'hospital', pickupPoint: null });
    expect((await failure(create(actor, { ...body, slug: 'otro', name: '¿?' }))).status).toBe(400);
    expect(
      (await failure(create({ ...actor, userId: 'exadmin' }, { ...body, slug: 'otro' }))).status,
    ).toBe(403);
    places.get = async () => null;
    expect((await failure(create(actor, { ...body, slug: 'nuevo' }))).status).toBe(404);
  });

  it('editar avisa solo con cambios reales; guardado que desaparece → 404', async () => {
    const places = setup();
    const id = places.seed('hospital', 'Hospital', PLACES.VILLAGARZON_CENTER);
    let changes = 0;
    const update = makeUpdatePlace({ places, onChange: () => changes++ });
    await update(actor, id, { verified: false });
    expect(changes).toBe(0);
    await update(actor, id, { name: 'Hospital San Gabriel', category: 'HEALTH', source: '  ' });
    expect(changes).toBe(1);
    expect(await places.get(id)).toMatchObject({ name: 'Hospital San Gabriel', source: null });
    await update(actor, id, { pickupPoint: { lat: 1.0296, lng: -76.6166 } });
    await update(actor, id, { pickupPoint: null });
    expect((await places.get(id))!.pickupPoint).toBeNull();
    places.get = async () => null;
    expect((await failure(update(actor, id, { verified: true }))).status).toBe(404);
  });
});
