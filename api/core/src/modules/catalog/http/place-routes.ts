import { createRoute, z } from '@hono/zod-openapi';
import {
  CatalogHistoryResponseSchema,
  NearbyPlacesResponseSchema,
  NearbyQuerySchema,
  PlaceCategorySchema,
  PlaceCreateBodySchema,
  PlaceRoutes,
  PlaceSchema,
  PlacesQuerySchema,
  PlacesResponseSchema,
  PlaceUpdateBodySchema,
  Role,
} from '@panter/contracts';
import type { MiddlewareHandler } from 'hono';
import type { AppBindings, Env } from '../../../env';
import { createRouter } from '../../../shared/http/create-app';
import { requireRole } from '../../auth/http/authorize';
import { getActor } from '../../auth/http/require-auth';
import type { ListCatalogHistory } from '../application/history';
import type { CreatePlace, ListPlaces, NearbyPlaces, UpdatePlace } from '../application/places';
import {
  BooleanQuery,
  error,
  HistoryQuerySchema,
  IdParam,
  isTrue,
  json,
  openapiPath,
  optionalAuth,
  PUBLIC_CACHE,
  security,
  viewerOf,
} from './shared';

/** Fábricas de lugares de interés (raíz de composición). */
export interface PlaceFactories {
  list: (env: Env) => ListPlaces;
  nearby: (env: Env) => NearbyPlaces;
  create: (env: Env) => CreatePlace;
  update: (env: Env) => UpdatePlace;
  history: (env: Env) => ListCatalogHistory;
}

const ListQuery = z.object({
  q: z.string().max(80).optional().openapi({ example: 'rio guineo' }),
  category: PlaceCategorySchema.optional(),
  includeInactive: BooleanQuery,
  limit: z.string().optional().openapi({ example: '50', description: '1 a 100 (por defecto 50)' }),
});

const NearbyQuery = z.object({
  lat: z.string().openapi({ example: '1.0295' }),
  lng: z.string().openapi({ example: '-76.6165' }),
  radiusMeters: z.string().optional().openapi({ example: '300', description: '10 a 2000' }),
  limit: z.string().optional().openapi({ example: '5', description: '1 a 20' }),
});

const commonErrors = {
  401: error('UNAUTHENTICATED o TOKEN_EXPIRED'),
  403: error('FORBIDDEN: se necesita el rol ADMIN'),
};

/**
 * Lugares de interés (HU-310): catálogo público (la app y la web lo leen en lugar de las
 * coordenadas fijas de antes) y administración solo para ADMIN con historial. `verified`
 * indica si la ubicación se confirmó en sitio; los sembrados en 0007, salvo el aeropuerto, no.
 */
export function placeRoutes(
  build: PlaceFactories,
  requireAuth: () => MiddlewareHandler<AppBindings>,
) {
  const guard = (): MiddlewareHandler<AppBindings>[] => [requireAuth(), requireRole(Role.ADMIN)];

  const listRoute = createRoute({
    method: 'get',
    path: PlaceRoutes.LIST,
    tags: ['catálogo'],
    summary: 'Lugares de interés',
    description:
      'Ordenados por nombre, cada uno con su barrio o vereda. `q` busca sin tildes ni ' +
      'mayúsculas; `category` filtra; `limit` hasta 100. `includeInactive=true` solo con token de ADMIN.',
    middleware: [optionalAuth(requireAuth)],
    request: { query: ListQuery },
    responses: {
      200: { description: 'Lugares', content: json(PlacesResponseSchema) },
      400: error('VALIDATION_ERROR'),
      ...commonErrors,
    },
  });

  const nearbyRoute = createRoute({
    method: 'get',
    path: PlaceRoutes.NEARBY,
    tags: ['catálogo'],
    summary: 'Lugares cerca de un punto',
    description:
      'Lugares activos a menos de `radiusMeters` (300 por defecto), del más cercano al más ' +
      'lejano, con `distanceMeters`. Vacío fuera del área de servicio.',
    request: { query: NearbyQuery },
    responses: {
      200: { description: 'Lugares cercanos', content: json(NearbyPlacesResponseSchema) },
      400: error('VALIDATION_ERROR'),
    },
  });

  const createPlaceRoute = createRoute({
    method: 'post',
    path: PlaceRoutes.ADMIN_CREATE,
    tags: ['catálogo'],
    summary: 'Crear un lugar',
    description:
      'Ubicación y punto de recogida dentro del área de servicio (la recogida a menos de 1 km ' +
      'del lugar). El barrio o vereda se calcula al guardar. Slug único.',
    security,
    middleware: guard(),
    request: { body: { required: true, content: json(PlaceCreateBodySchema) } },
    responses: {
      201: { description: 'Creado', content: json(PlaceSchema) },
      400: error('VALIDATION_ERROR'),
      ...commonErrors,
      409: error('PLACE_SLUG_TAKEN'),
      422: error('OUT_OF_SERVICE_AREA (details.point: location o pickupPoint)'),
    },
  });

  const updatePlaceRoute = createRoute({
    method: 'patch',
    path: openapiPath(PlaceRoutes.ADMIN_UPDATE),
    tags: ['catálogo'],
    summary: 'Editar, verificar o desactivar un lugar',
    description:
      'Solo cambia los campos enviados: corregir la ubicación (recalcula el barrio), ' +
      '`verified: true` al confirmarla en sitio, `pickupPoint: null` para quitarlo, ' +
      '`active: false` para desactivarlo. Sin cambios no hay historial.',
    security,
    middleware: guard(),
    request: {
      params: z.object({ id: IdParam }),
      body: { required: true, content: json(PlaceUpdateBodySchema) },
    },
    responses: {
      200: { description: 'Guardado', content: json(PlaceSchema) },
      400: error('VALIDATION_ERROR'),
      ...commonErrors,
      404: error('NOT_FOUND'),
      422: error('OUT_OF_SERVICE_AREA'),
    },
  });

  const historyRoute = createRoute({
    method: 'get',
    path: openapiPath(PlaceRoutes.ADMIN_HISTORY),
    tags: ['catálogo'],
    summary: 'Historial de un lugar',
    description: 'Del más reciente al más antiguo, con autor y valores antes y después.',
    security,
    middleware: guard(),
    request: { params: z.object({ id: IdParam }), query: HistoryQuerySchema },
    responses: {
      200: { description: 'Historial', content: json(CatalogHistoryResponseSchema) },
      400: error('VALIDATION_ERROR: cursor inválido'),
      ...commonErrors,
    },
  });

  return createRouter()
    .openapi(listRoute, async (c) => {
      const raw = c.req.valid('query');
      const query = PlacesQuerySchema.parse({
        ...raw,
        includeInactive: isTrue(raw.includeInactive),
      });
      const viewer = viewerOf(c);
      const result = await build.list(c.env)(query, viewer);
      c.header('Cache-Control', viewer.isAdmin ? 'no-store' : PUBLIC_CACHE);
      return c.json(result, 200);
    })
    .openapi(nearbyRoute, async (c) => {
      const query = NearbyQuerySchema.parse(c.req.valid('query'));
      c.header('Cache-Control', PUBLIC_CACHE);
      return c.json(await build.nearby(c.env)(query), 200);
    })
    .openapi(createPlaceRoute, async (c) => {
      return c.json(await build.create(c.env)(getActor(c), c.req.valid('json')), 201);
    })
    .openapi(updatePlaceRoute, async (c) => {
      const { id } = c.req.valid('param');
      return c.json(await build.update(c.env)(getActor(c), id, c.req.valid('json')), 200);
    })
    .openapi(historyRoute, async (c) => {
      c.header('Cache-Control', 'no-store');
      const { id } = c.req.valid('param');
      return c.json(await build.history(c.env)(id, c.req.valid('query')), 200);
    });
}
