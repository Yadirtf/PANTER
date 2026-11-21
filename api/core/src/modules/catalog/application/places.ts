import {
  isInServiceArea,
  searchKey,
  type NearbyPlacesResponse,
  type NearbyQuery,
  type Place,
  type PlaceCreateBody,
  type PlacesQuery,
  type PlacesResponse,
  type PlaceUpdateBody,
} from '@panter/contracts';
import type { Actor } from '../../auth/domain/actor';
import {
  PICKUP_MAX_DISTANCE_METERS,
  pickupTooFar,
  placePointOutside,
} from '../domain/place-policy';
import type { Viewer } from './areas';
import { CatalogErrors } from './errors';
import type {
  OnCatalogChange,
  PlacePatch,
  PlaceReader,
  PlaceRepository,
  PlaceWriteResult,
} from './ports';

/** GET /places */
export type ListPlaces = (query: PlacesQuery, viewer: Viewer) => Promise<PlacesResponse>;

/**
 * Catálogo de lugares (HU-310): búsqueda sin tildes (`searchKey`, ILIKE sobre `name_search`),
 * filtro por categoría y su barrio o vereda. `includeInactive` es solo para ADMIN → 403.
 */
export function makeListPlaces(deps: { places: PlaceReader }): ListPlaces {
  return async ({ q, category, includeInactive, limit }, viewer) => {
    if (includeInactive && !viewer.isAdmin) throw CatalogErrors.forbidden();
    const search = q ? searchKey(q) : '';
    const items = await deps.places.list({
      ...(search ? { search } : {}),
      ...(category ? { category } : {}),
      includeInactive,
      limit,
    });
    return { items };
  };
}

/** GET /places/nearby */
export type NearbyPlaces = (query: NearbyQuery) => Promise<NearbyPlacesResponse>;

/**
 * Lugares activos cerca de un punto (`ST_DWithin`), del más cercano al más lejano, con
 * `distanceMeters`: sirve para "cerca de Parque principal". Fuera del área de servicio, vacío.
 */
export function makeNearbyPlaces(deps: { places: PlaceReader }): NearbyPlaces {
  return async ({ lat, lng, radiusMeters, limit }) => {
    const point = { lat, lng };
    if (!isInServiceArea(point)) return { items: [] };
    return { items: await deps.places.nearby({ point, radiusMeters, limit }) };
  };
}

function checkPoints(location: Place['location'], pickupPoint: Place['pickupPoint']) {
  const outside = placePointOutside(location, pickupPoint);
  if (outside) throw CatalogErrors.placeOutOfServiceArea(outside);
  if (pickupTooFar(location, pickupPoint)) {
    throw CatalogErrors.pickupTooFar(PICKUP_MAX_DISTANCE_METERS);
  }
}

function checkWrite(result: PlaceWriteResult, slug: string) {
  if (!result.actorIsAdmin) throw CatalogErrors.forbidden();
  if (!result.exists) throw CatalogErrors.placeNotFound();
  if (result.slugTaken) throw CatalogErrors.placeSlugTaken(slug);
}

function nameSearchOf(name: string): string {
  const key = searchKey(name);
  if (!key) throw CatalogErrors.invalidName();
  return key;
}

const cleanSource = (source: string | null | undefined) => source?.trim() || null;

/** POST /admin/places */
export type CreatePlace = (actor: Actor, body: PlaceCreateBody) => Promise<Place>;

/**
 * Crea un lugar (HU-310):
 * - ubicación y punto de recogida dentro de SERVICE_AREA → si no, 422 `OUT_OF_SERVICE_AREA`
 *   (`details.point`); recogida a más de 1 km del lugar → 400;
 * - slug único → 409 `PLACE_SLUG_TAKEN`;
 * - su barrio o vereda (`area_id`) lo calcula PostGIS con `ST_Covers` al guardar;
 * - `verified` dice si la ubicación se confirmó en sitio (GPS o mapa); por defecto false.
 * Historial (CREATE) en la misma sentencia; quien ya no es ADMIN en la base de datos → 403.
 */
export function makeCreatePlace(deps: {
  places: PlaceRepository;
  onChange?: OnCatalogChange;
}): CreatePlace {
  return async (actor, body) => {
    const pickupPoint = body.pickupPoint ?? null;
    checkPoints(body.location, pickupPoint);
    const result = await deps.places.create({
      actorId: actor.userId,
      place: {
        slug: body.slug,
        name: body.name,
        nameSearch: nameSearchOf(body.name),
        category: body.category,
        location: body.location,
        pickupPoint,
        verified: body.verified,
        source: cleanSource(body.source),
      },
    });
    checkWrite(result, body.slug);
    deps.onChange?.();
    const saved = result.id ? await deps.places.get(result.id) : null;
    if (!saved) throw CatalogErrors.placeNotFound();
    return saved;
  };
}

/** PATCH /admin/places/:id */
export type UpdatePlace = (actor: Actor, id: string, body: PlaceUpdateBody) => Promise<Place>;

/**
 * Edita un lugar: corregir la ubicación (y con ella su barrio), marcarlo verificado, cambiar
 * el punto de recogida (`null` lo quita) o desactivarlo (`active: false`). El slug no cambia:
 * es el identificador estable que usan los clientes. Sin cambios no hay historial.
 */
export function makeUpdatePlace(deps: {
  places: PlaceRepository;
  onChange?: OnCatalogChange;
}): UpdatePlace {
  return async (actor, id, body) => {
    if (body.location !== undefined || body.pickupPoint !== undefined) {
      const current = await deps.places.get(id);
      if (!current) throw CatalogErrors.placeNotFound();
      checkPoints(
        body.location ?? current.location,
        body.pickupPoint === undefined ? current.pickupPoint : body.pickupPoint,
      );
    }
    const patch: PlacePatch = {
      ...(body.name === undefined ? {} : { name: body.name, nameSearch: nameSearchOf(body.name) }),
      ...(body.category === undefined ? {} : { category: body.category }),
      ...(body.location === undefined ? {} : { location: body.location }),
      ...(body.pickupPoint === undefined ? {} : { pickupPoint: body.pickupPoint }),
      ...(body.verified === undefined ? {} : { verified: body.verified }),
      ...(body.source === undefined ? {} : { source: cleanSource(body.source) }),
      ...(body.active === undefined ? {} : { active: body.active }),
    };
    const result = await deps.places.update({ id, actorId: actor.userId, patch });
    checkWrite(result, '');
    if (result.changed) deps.onChange?.();
    const saved = await deps.places.get(id);
    if (!saved) throw CatalogErrors.placeNotFound();
    return saved;
  };
}
