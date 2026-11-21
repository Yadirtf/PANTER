// Catálogo geográfico de E15 (HU-308 y HU-310) con el contrato de packages/contracts/src/catalog.ts.
// Todas son consultas públicas (sin sesión): sirven antes de iniciar sesión y no gastan refresh.
import {
  type Area,
  type AreaLocateResponse,
  AreaLocateResponseSchema,
  AreaRoutes,
  AreaSchema,
  type AreasResponse,
  AreasResponseSchema,
  areaPath,
  type LatLng,
  type NearbyPlacesResponse,
  NearbyPlacesResponseSchema,
  PlaceRoutes,
  type PlacesResponse,
  PlacesResponseSchema,
} from '@panter/contracts';
import type { HttpClient } from '../../../shared/api/http-client';

/** Máximo de lugares que acepta GET /places (PlacesQuerySchema). */
export const PLACES_PAGE_LIMIT = 100;
/** Radio de "cerca de Y" (el mismo valor por defecto de NearbyQuerySchema). */
export const NEARBY_RADIUS_METERS = 300;

export interface CatalogApi {
  /** GET /areas: barrios y veredas activos, sin polígono. */
  listAreas(): Promise<AreasResponse>;
  /** GET /areas/:id: con polígono y centro. */
  getArea(id: string): Promise<Area>;
  /** GET /areas/locate: barrio o vereda que contiene el punto, o `null`. */
  locateArea(point: LatLng): Promise<AreaLocateResponse>;
  /** GET /places: lugares activos del catálogo. */
  listPlaces(): Promise<PlacesResponse>;
  /** GET /places/nearby: lugares cercanos, del más cercano al más lejano. */
  nearbyPlaces(point: LatLng, limit?: number): Promise<NearbyPlacesResponse>;
}

const coords = (point: LatLng) => `lat=${point.lat}&lng=${point.lng}`;

export function createCatalogApi(http: HttpClient): CatalogApi {
  return {
    listAreas: () => http.request({ path: AreaRoutes.LIST, schema: AreasResponseSchema }),
    getArea: (id) => http.request({ path: areaPath(id), schema: AreaSchema }),
    locateArea: (point) =>
      http.request({
        path: `${AreaRoutes.LOCATE}?${coords(point)}`,
        schema: AreaLocateResponseSchema,
      }),
    listPlaces: () =>
      http.request({
        path: `${PlaceRoutes.LIST}?limit=${PLACES_PAGE_LIMIT}`,
        schema: PlacesResponseSchema,
      }),
    nearbyPlaces: (point, limit = 1) =>
      http.request({
        path: `${PlaceRoutes.NEARBY}?${coords(point)}&radiusMeters=${NEARBY_RADIUS_METERS}&limit=${limit}`,
        schema: NearbyPlacesResponseSchema,
      }),
  };
}
