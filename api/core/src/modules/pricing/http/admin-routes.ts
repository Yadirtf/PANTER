import { createRoute, z } from '@hono/zod-openapi';
import {
  FareConfigResponseSchema,
  FareHistoryQuerySchema,
  FareHistoryResponseSchema,
  FareRoutes,
  FareRuleSchema,
  FareRuleUpdateBodySchema,
  GeofenceSchema,
  GeofenceUpdateBodySchema,
  Role,
  VehicleType,
} from '@panter/contracts';
import type { MiddlewareHandler } from 'hono';
import type { AppBindings, Env } from '../../../env';
import { createRouter } from '../../../shared/http/create-app';
import { ErrorSchema } from '../../../shared/http/schemas';
import { requireRole } from '../../auth/http/authorize';
import { getActor } from '../../auth/http/require-auth';
import type {
  GetFareConfig,
  ListFareHistory,
  UpdateFareRule,
  UpdateGeofence,
} from '../application/admin-fares';

/** Fábricas de la administración de tarifas (raíz de composición). */
export interface PricingAdminFactories {
  getConfig: (env: Env) => GetFareConfig;
  updateRule: (env: Env) => UpdateFareRule;
  updateGeofence: (env: Env) => UpdateGeofence;
  listHistory: (env: Env) => ListFareHistory;
}

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });
const security = [{ bearerAuth: [] }];
const openapiPath = (path: string) => path.replace(/:(\w+)/g, '{$1}');

const VehicleTypeParam = z
  .enum(VehicleType)
  .openapi({ param: { name: 'vehicleType', in: 'path' } });
const GeofenceIdParam = z.uuid().openapi({ param: { name: 'id', in: 'path' } });

const commonErrors = {
  401: error('UNAUTHENTICATED o TOKEN_EXPIRED'),
  403: error('FORBIDDEN: se necesita el rol ADMIN'),
};

/**
 * Administración de tarifas y geocercas (HU-401, la usa la web en HU-403). Solo ADMIN:
 * `requireAuth()` + `requireRole('ADMIN')`, y cada edición vuelve a comprobar en la base de
 * datos que el actor sigue siendo ADMIN. Cada cambio queda en el historial (fare_changes).
 */
export function pricingAdminRoutes(
  build: PricingAdminFactories,
  requireAuth: () => MiddlewareHandler<AppBindings>,
) {
  const guard = (): MiddlewareHandler<AppBindings>[] => [requireAuth(), requireRole(Role.ADMIN)];

  const configRoute = createRoute({
    method: 'get',
    path: FareRoutes.ADMIN_CONFIG,
    tags: ['tarifas'],
    summary: 'Reglas de tarifa y geocercas',
    description: 'Todas las reglas (por tipo de vehículo) y geocercas, incluidas las inactivas.',
    security,
    middleware: guard(),
    responses: {
      200: { description: 'Configuración de tarifas', content: json(FareConfigResponseSchema) },
      ...commonErrors,
    },
  });

  const ruleRoute = createRoute({
    method: 'put',
    path: openapiPath(FareRoutes.ADMIN_RULE),
    tags: ['tarifas'],
    summary: 'Editar la regla de un tipo de vehículo',
    description:
      'Reemplaza la regla. Reglas de negocio: montos ≥ 0, `roundTo` divide $1.000 y FLAT con ' +
      '`perKm` y `perMinute` en 0. Sin cambios reales no se registra nada en el historial.',
    security,
    middleware: guard(),
    request: {
      params: z.object({ vehicleType: VehicleTypeParam }),
      body: { required: true, content: json(FareRuleUpdateBodySchema) },
    },
    responses: {
      200: { description: 'Regla guardada', content: json(FareRuleSchema) },
      400: error('VALIDATION_ERROR (details con cada campo)'),
      ...commonErrors,
      404: error('FARE_RULE_NOT_FOUND'),
    },
  });

  const geofenceRoute = createRoute({
    method: 'put',
    path: openapiPath(FareRoutes.ADMIN_GEOFENCE),
    tags: ['tarifas'],
    summary: 'Editar una geocerca',
    description:
      'Reemplaza nombre, polígono, recargo, tipos de vehículo y estado. El polígono debe tener ' +
      'anillos de al menos 3 vértices, quedar dentro del área de servicio y ser válido para ' +
      'PostGIS (sin bordes cruzados).',
    security,
    middleware: guard(),
    request: {
      params: z.object({ id: GeofenceIdParam }),
      body: { required: true, content: json(GeofenceUpdateBodySchema) },
    },
    responses: {
      200: { description: 'Geocerca guardada', content: json(GeofenceSchema) },
      400: error('VALIDATION_ERROR (polígono inválido u otros campos)'),
      ...commonErrors,
      404: error('NOT_FOUND: la geocerca no existe'),
    },
  });

  const historyRoute = createRoute({
    method: 'get',
    path: FareRoutes.ADMIN_HISTORY,
    tags: ['tarifas'],
    summary: 'Historial de cambios de tarifas',
    description:
      'Del más reciente al más antiguo, con autor (correo) y valores antes y después. Pasa ' +
      '`nextCursor` como `cursor` para la página siguiente.',
    security,
    middleware: guard(),
    request: { query: FareHistoryQuerySchema },
    responses: {
      200: { description: 'Página del historial', content: json(FareHistoryResponseSchema) },
      400: error('VALIDATION_ERROR: límite o cursor inválidos'),
      ...commonErrors,
    },
  });

  return createRouter()
    .openapi(configRoute, async (c) => {
      c.header('Cache-Control', 'no-store');
      return c.json(await build.getConfig(c.env)(), 200);
    })
    .openapi(ruleRoute, async (c) => {
      const { vehicleType } = c.req.valid('param');
      const rule = await build.updateRule(c.env)(getActor(c), vehicleType, c.req.valid('json'));
      return c.json(rule, 200);
    })
    .openapi(geofenceRoute, async (c) => {
      const { id } = c.req.valid('param');
      const geofence = await build.updateGeofence(c.env)(getActor(c), id, c.req.valid('json'));
      return c.json(geofence, 200);
    })
    .openapi(historyRoute, async (c) => {
      c.header('Cache-Control', 'no-store');
      return c.json(await build.listHistory(c.env)(c.req.valid('query')), 200);
    });
}
