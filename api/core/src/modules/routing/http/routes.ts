import { createRoute, z } from '@hono/zod-openapi';
import { MapRoutes, RouteQuerySchema, RouteResponseSchema } from '@panter/contracts';
import type { MiddlewareHandler } from 'hono';
import type { AppBindings, Env } from '../../../env';
import { createRouter } from '../../../shared/http/create-app';
import { ErrorSchema } from '../../../shared/http/schemas';
import { getActor } from '../../auth/http/require-auth';
import type { GetRoute } from '../application/get-route';

/** Fábricas del módulo routing (raíz de composición). */
export interface RoutingFactories {
  getRoute: (env: Env) => GetRoute;
}

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });

// En la query llegan como texto "lat,lng"; RouteQuerySchema (contracts) las convierte y valida.
const QuerySchema = z.object({
  origin: z.string().openapi({ example: '1.0295,-76.6165', description: 'lat,lng' }),
  destination: z.string().openapi({ example: '0.9789,-76.6053', description: 'lat,lng' }),
  profile: z.string().optional().openapi({ example: 'driving-car' }),
});

/** GET /routes (HU-305): ruta por carretera con OpenRouteService, con caché de 10 minutos. */
export function routingRoutes(
  build: RoutingFactories,
  requireAuth: () => MiddlewareHandler<AppBindings>,
) {
  const route = createRoute({
    method: 'get',
    path: MapRoutes.ROUTE,
    tags: ['mapas'],
    summary: 'Ruta entre dos puntos',
    description:
      'Distancia, duración, polilínea (precisión 5) y bbox de la ruta en carro con ' +
      'OpenRouteService. Caché de 10 minutos por par de coordenadas redondeadas a 4 decimales ' +
      '(`cached: true` si no consumió cuota). Origen y destino deben estar en el área de servicio. ' +
      'HU-307: siempre la ruta más corta (preference shortest con hasta 3 alternativas en una ' +
      'sola consulta) y `quality` con el ajuste a la vía de cada punto (a más de 50 m la app pide ' +
      'confirmar el pin) y la marca de ruta inusual (más de 2,5 veces la línea recta, desde 1 km).',
    security: [{ bearerAuth: [] }],
    middleware: [requireAuth()],
    request: { query: QuerySchema },
    responses: {
      200: { description: 'Ruta', content: json(RouteResponseSchema) },
      400: error('VALIDATION_ERROR: coordenadas con formato inválido'),
      401: error('UNAUTHENTICATED o TOKEN_EXPIRED'),
      422: error('OUT_OF_SERVICE_AREA (details.point) o ROUTE_NOT_FOUND'),
      429: error('ROUTING_UNAVAILABLE: límite de consultas del usuario (Retry-After)'),
      503: error('ROUTING_UNAVAILABLE: OpenRouteService caído, sin cuota o sin configurar'),
    },
  });

  return createRouter().openapi(route, async (c) => {
    const query = RouteQuerySchema.parse(c.req.valid('query'));
    const result = await build.getRoute(c.env)({ userId: getActor(c).userId, ...query });
    c.header('Cache-Control', 'private, max-age=60');
    return c.json(result, 200);
  });
}
