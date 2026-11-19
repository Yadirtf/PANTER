import { createRoute } from '@hono/zod-openapi';
import { DriverApplyBodySchema, DriverProfileSchema, DriverRoutes } from '@panter/contracts';
import type { MiddlewareHandler } from 'hono';
import type { AppBindings, Env } from '../../../env';
import { createRouter } from '../../../shared/http/create-app';
import { ErrorSchema } from '../../../shared/http/schemas';
import { getActor } from '../../auth/http/require-auth';
import type { ApplyAsDriver, GetMyDriverProfile } from '../application/apply';

/** Fábricas de los casos de uso del solicitante (raíz de composición). */
export interface DriverFactories {
  apply: (env: Env) => ApplyAsDriver;
  getMine: (env: Env) => GetMyDriverProfile;
}

export interface DriverGuards {
  requireAuth: () => MiddlewareHandler<AppBindings>;
  /** HU-109: los datos del vehículo y los documentos exigen el aviso de privacidad aceptado. */
  requireConsent: () => MiddlewareHandler<AppBindings>;
}

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });
const security = [{ bearerAuth: [] }];

/** Rutas del solicitante (HU-201): POST /drivers/apply y GET /drivers/me. */
export function driverRoutes(build: DriverFactories, guards: DriverGuards) {
  const applyRoute = createRoute({
    method: 'post',
    path: DriverRoutes.APPLY,
    tags: ['drivers'],
    summary: 'Solicitar ser conductor',
    description:
      'Registra el vehículo y crea el perfil en PENDING (placa colombiana: ABC123 para carros, ' +
      'ABC12D para motos). No otorga el rol DRIVER: llega cuando un ADMIN aprueba. Si la ' +
      'solicitud fue rechazada, la reenvía con el vehículo corregido y vuelve a PENDING.',
    security,
    middleware: [guards.requireAuth(), guards.requireConsent()] as const,
    request: { body: { required: true, content: json(DriverApplyBodySchema) } },
    responses: {
      201: { description: 'Perfil de conductor', content: json(DriverProfileSchema) },
      400: error('VALIDATION_ERROR: vehículo o placa inválidos'),
      401: error('UNAUTHENTICATED o TOKEN_EXPIRED'),
      403: error('CONSENT_REQUIRED'),
      409: error('DRIVER_ALREADY_APPLIED o PLATE_ALREADY_REGISTERED'),
    },
  });

  const meRoute = createRoute({
    method: 'get',
    path: DriverRoutes.ME,
    tags: ['drivers'],
    summary: 'Mi perfil de conductor',
    description:
      'Estado de la solicitud, vehículo, documentos subidos y los que faltan o hay que corregir.',
    security,
    middleware: [guards.requireAuth()] as const,
    responses: {
      200: { description: 'Perfil de conductor', content: json(DriverProfileSchema) },
      401: error('UNAUTHENTICATED o TOKEN_EXPIRED'),
      404: error('DRIVER_NOT_APPLIED'),
    },
  });

  return createRouter()
    .openapi(applyRoute, async (c) => {
      const profile = await build.apply(c.env)(getActor(c), c.req.valid('json'));
      c.header('Cache-Control', 'no-store');
      return c.json(profile, 201);
    })
    .openapi(meRoute, async (c) => {
      const profile = await build.getMine(c.env)(getActor(c));
      c.header('Cache-Control', 'no-store');
      return c.json(profile, 200);
    });
}
