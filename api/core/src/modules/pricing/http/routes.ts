import { createRoute } from '@hono/zod-openapi';
import { FareEstimateBodySchema, FareEstimateResponseSchema, FareRoutes } from '@panter/contracts';
import type { MiddlewareHandler } from 'hono';
import type { AppBindings, Env } from '../../../env';
import { createRouter } from '../../../shared/http/create-app';
import { ErrorSchema } from '../../../shared/http/schemas';
import { getActor } from '../../auth/http/require-auth';
import type { EstimateFare } from '../application/estimate-fare';

/** Fábricas del estimado de tarifa (raíz de composición). */
export interface PricingFactories {
  estimate: (env: Env) => EstimateFare;
}

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });

/** POST /fares/estimate (HU-402). */
export function pricingRoutes(
  build: PricingFactories,
  requireAuth: () => MiddlewareHandler<AppBindings>,
) {
  const route = createRoute({
    method: 'post',
    path: FareRoutes.ESTIMATE,
    tags: ['tarifas'],
    summary: 'Estimar la tarifa de un viaje',
    description:
      'Precio en COP con desglose (base, distancia, tiempo, mínima, nocturno, geocercas y ' +
      'redondeo), la ruta y hasta cuándo se respeta el valor. Usa la misma caché de rutas que ' +
      'GET /routes.',
    security: [{ bearerAuth: [] }],
    middleware: [requireAuth()],
    request: { body: { required: true, content: json(FareEstimateBodySchema) } },
    responses: {
      200: { description: 'Estimado', content: json(FareEstimateResponseSchema) },
      400: error('VALIDATION_ERROR'),
      401: error('UNAUTHENTICATED o TOKEN_EXPIRED'),
      404: error('FARE_RULE_NOT_FOUND: no hay tarifa activa para ese vehículo'),
      422: error('OUT_OF_SERVICE_AREA o ROUTE_NOT_FOUND'),
      429: error('ROUTING_UNAVAILABLE: límite de consultas del usuario (Retry-After)'),
      503: error('ROUTING_UNAVAILABLE'),
    },
  });

  return createRouter().openapi(route, async (c) => {
    const estimate = await build.estimate(c.env)(getActor(c).userId, c.req.valid('json'));
    c.header('Cache-Control', 'no-store');
    return c.json(estimate, 200);
  });
}
