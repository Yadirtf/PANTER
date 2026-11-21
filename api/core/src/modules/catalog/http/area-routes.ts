import { createRoute, z } from '@hono/zod-openapi';
import {
  AREA_IMPORT_MAX_FEATURES,
  AreaCreateBodySchema,
  AreaImportBodySchema,
  AreaImportResultSchema,
  AreaKindSchema,
  AreaLocateResponseSchema,
  AreaRoutes,
  AreaSchema,
  AreasQuerySchema,
  AreasResponseSchema,
  AreaUpdateBodySchema,
  CatalogHistoryResponseSchema,
  LocateQuerySchema,
  Role,
} from '@panter/contracts';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppBindings, Env } from '../../../env';
import { AppError } from '../../../shared/errors/app-error';
import { createRouter } from '../../../shared/http/create-app';
import { requireRole } from '../../auth/http/authorize';
import { getActor } from '../../auth/http/require-auth';
import type {
  CreateArea,
  GetArea,
  ImportAreas,
  ListAreas,
  LocateArea,
  UpdateArea,
} from '../application/areas';
import type { ListCatalogHistory } from '../application/history';
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

/** Fábricas de barrios y veredas (raíz de composición). */
export interface AreaFactories {
  list: (env: Env) => ListAreas;
  get: (env: Env) => GetArea;
  locate: (env: Env) => LocateArea;
  create: (env: Env) => CreateArea;
  update: (env: Env) => UpdateArea;
  importAreas: (env: Env) => ImportAreas;
  history: (env: Env) => ListCatalogHistory;
}

/**
 * Tamaño máximo del cuerpo de la importación: 5 MB alcanzan para los 500 polígonos permitidos
 * con cientos de vértices cada uno. Un GeoJSON más grande suele venir sin simplificar.
 */
export const AREA_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

const importTooLarge = () =>
  new AppError(
    'PAYLOAD_TOO_LARGE',
    `El archivo es demasiado grande: el máximo es ${AREA_IMPORT_MAX_BYTES / 1024 / 1024} MB. Simplifica los polígonos (por ejemplo con QGIS → Vectorial → Geometría → Simplificar) o divídelo en partes.`,
    { status: 413, details: { maxBytes: AREA_IMPORT_MAX_BYTES } },
  );

const ListQuery = z.object({
  q: z.string().max(80).optional().openapi({ example: 'pozo azul' }),
  kind: AreaKindSchema.optional(),
  includeInactive: BooleanQuery,
});

const LocateQuery = z.object({
  lat: z.string().openapi({ example: '1.0295' }),
  lng: z.string().openapi({ example: '-76.6165' }),
});

const commonErrors = {
  401: error('UNAUTHENTICATED o TOKEN_EXPIRED'),
  403: error('FORBIDDEN: se necesita el rol ADMIN'),
};

/**
 * Barrios y veredas (HU-308). Lectura pública (la app y la web los usan para describir origen y
 * destino) con caché de 60 s en el isolate; administración solo para ADMIN, que además se
 * comprueba en la base de datos en cada escritura. Cada cambio queda en `catalog_changes`.
 */
export function areaRoutes(
  build: AreaFactories,
  requireAuth: () => MiddlewareHandler<AppBindings>,
) {
  const guard = (): MiddlewareHandler<AppBindings>[] => [requireAuth(), requireRole(Role.ADMIN)];

  const listRoute = createRoute({
    method: 'get',
    path: AreaRoutes.LIST,
    tags: ['catálogo'],
    summary: 'Barrios y veredas',
    description:
      'Sin polígono, ordenados por tipo y nombre. `q` busca sin tildes ni mayúsculas ' +
      '("pozo azul" encuentra "Pozo Azul"). `includeInactive=true` solo con token de ADMIN.',
    middleware: [optionalAuth(requireAuth)],
    request: { query: ListQuery },
    responses: {
      200: { description: 'Barrios y veredas', content: json(AreasResponseSchema) },
      400: error('VALIDATION_ERROR'),
      ...commonErrors,
    },
  });

  const locateRoute = createRoute({
    method: 'get',
    path: AreaRoutes.LOCATE,
    tags: ['catálogo'],
    summary: 'Barrio o vereda de un punto',
    description:
      'El barrio o vereda activo que cubre el punto (el borde cuenta como dentro); si se ' +
      'solapan, el de menor área. `area: null` si ninguno lo cubre o está fuera del área de servicio.',
    request: { query: LocateQuery },
    responses: {
      200: { description: 'Barrio o vereda', content: json(AreaLocateResponseSchema) },
      400: error('VALIDATION_ERROR: lat o lng inválidos'),
    },
  });

  const detailRoute = createRoute({
    method: 'get',
    path: openapiPath(AreaRoutes.DETAIL),
    tags: ['catálogo'],
    summary: 'Barrio o vereda con su polígono',
    description:
      'Polígono (anillos `{ lat, lng }`) y centro para dibujar el croquis. Uno desactivado solo ' +
      'lo ve un ADMIN; `updatedBy` (correo) solo sale con token de ADMIN.',
    middleware: [optionalAuth(requireAuth)],
    request: { params: z.object({ id: IdParam }) },
    responses: {
      200: { description: 'Barrio o vereda', content: json(AreaSchema) },
      400: error('VALIDATION_ERROR: id inválido'),
      401: error('UNAUTHENTICATED o TOKEN_EXPIRED (si se envió un token inválido)'),
      404: error('NOT_FOUND'),
    },
  });

  const createAreaRoute = createRoute({
    method: 'post',
    path: AreaRoutes.ADMIN_CREATE,
    tags: ['catálogo'],
    summary: 'Crear un barrio o vereda',
    description:
      'El polígono debe quedar dentro del área de servicio y ser válido para PostGIS ' +
      '(`ST_IsValid`). Nombre único por tipo sin tildes ni mayúsculas.',
    security,
    middleware: guard(),
    request: { body: { required: true, content: json(AreaCreateBodySchema) } },
    responses: {
      201: { description: 'Creado', content: json(AreaSchema) },
      400: error('VALIDATION_ERROR'),
      ...commonErrors,
      409: error('AREA_NAME_TAKEN'),
      422: error('INVALID_POLYGON (details.reason con el motivo de PostGIS)'),
    },
  });

  const updateAreaRoute = createRoute({
    method: 'patch',
    path: openapiPath(AreaRoutes.ADMIN_UPDATE),
    tags: ['catálogo'],
    summary: 'Editar o desactivar un barrio o vereda',
    description:
      'Solo cambia los campos enviados (`active: false` lo desactiva). Si cambia el polígono o ' +
      'el estado, los lugares afectados recalculan su barrio. Sin cambios no hay historial.',
    security,
    middleware: guard(),
    request: {
      params: z.object({ id: IdParam }),
      body: { required: true, content: json(AreaUpdateBodySchema) },
    },
    responses: {
      200: { description: 'Guardado', content: json(AreaSchema) },
      400: error('VALIDATION_ERROR'),
      ...commonErrors,
      404: error('NOT_FOUND'),
      409: error('AREA_NAME_TAKEN'),
      422: error('INVALID_POLYGON'),
    },
  });

  const importRoute = createRoute({
    method: 'post',
    path: AreaRoutes.ADMIN_IMPORT,
    tags: ['catálogo'],
    summary: 'Importar barrios y veredas desde GeoJSON',
    description:
      `FeatureCollection de Polygon (o MultiPolygon de una parte), máximo ` +
      `${AREA_IMPORT_MAX_FEATURES} features y ${AREA_IMPORT_MAX_BYTES / 1024 / 1024} MB. ` +
      'Con `dryRun: true` (por defecto) solo valida y responde la vista previa con los errores ' +
      'por índice. Sin dryRun guarda las válidas: upsert por (tipo, nombre), todo en una sentencia.',
    security,
    middleware: [
      ...guard(),
      bodyLimit({
        maxSize: AREA_IMPORT_MAX_BYTES,
        onError: () => {
          throw importTooLarge();
        },
      }),
    ],
    request: { body: { required: true, content: json(AreaImportBodySchema) } },
    responses: {
      200: { description: 'Vista previa o resultado', content: json(AreaImportResultSchema) },
      400: error('VALIDATION_ERROR (p. ej. más features de las permitidas)'),
      ...commonErrors,
      413: error('PAYLOAD_TOO_LARGE'),
    },
  });

  const historyRoute = createRoute({
    method: 'get',
    path: openapiPath(AreaRoutes.ADMIN_HISTORY),
    tags: ['catálogo'],
    summary: 'Historial de un barrio o vereda',
    description:
      'Del más reciente al más antiguo, con autor (correo) y valores antes y después. Pasa ' +
      '`nextCursor` como `cursor` para la página siguiente.',
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
      const query = AreasQuerySchema.parse({
        ...raw,
        includeInactive: isTrue(raw.includeInactive),
      });
      const viewer = viewerOf(c);
      const result = await build.list(c.env)(query, viewer);
      c.header('Cache-Control', viewer.isAdmin ? 'no-store' : PUBLIC_CACHE);
      return c.json(result, 200);
    })
    .openapi(locateRoute, async (c) => {
      const query = LocateQuerySchema.parse(c.req.valid('query'));
      c.header('Cache-Control', PUBLIC_CACHE);
      return c.json(await build.locate(c.env)(query), 200);
    })
    .openapi(detailRoute, async (c) => {
      const viewer = viewerOf(c);
      const area = await build.get(c.env)(c.req.valid('param').id, viewer);
      c.header('Cache-Control', viewer.isAdmin ? 'no-store' : PUBLIC_CACHE);
      return c.json(area, 200);
    })
    .openapi(createAreaRoute, async (c) => {
      const area = await build.create(c.env)(getActor(c), c.req.valid('json'));
      return c.json(area, 201);
    })
    .openapi(updateAreaRoute, async (c) => {
      const { id } = c.req.valid('param');
      return c.json(await build.update(c.env)(getActor(c), id, c.req.valid('json')), 200);
    })
    .openapi(importRoute, async (c) => {
      c.header('Cache-Control', 'no-store');
      return c.json(await build.importAreas(c.env)(getActor(c), c.req.valid('json')), 200);
    })
    .openapi(historyRoute, async (c) => {
      c.header('Cache-Control', 'no-store');
      const { id } = c.req.valid('param');
      return c.json(await build.history(c.env)(id, c.req.valid('query')), 200);
    });
}
