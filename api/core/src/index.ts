import { buildAdminFactories } from './composition/admin';
import { buildAuthFactories, requireAuth, type IdentityFactories } from './composition/auth';
import { buildConsentFactories } from './composition/consent';
import { buildGetHealth } from './composition/health';
import { buildTilesFactories } from './composition/tiles';
// M2 · HU-305 (rutas)
import { buildRoutingFactories } from './composition/routing';
import { routingRoutes, type RoutingFactories } from './modules/routing/http/routes';
import { adminRoutes, type AdminFactories } from './modules/admin/http/routes';
import { consentRoutes, type ConsentFactories } from './modules/consent/http/routes';
import { meRoutes } from './modules/auth/http/me-routes';
import { authRoutes } from './modules/auth/http/routes';
import { healthRoutes } from './modules/health/http/routes';
import { tilesRoutes, type TilesFactories } from './modules/tiles/http/routes';
import { createRouter } from './shared/http/create-app';
import { corsMiddleware } from './shared/http/cors';
import { errorHandler, notFoundHandler } from './shared/http/errors';
import { ErrorSchema } from './shared/http/schemas';

export interface AppDeps {
  auth: IdentityFactories;
  admin: AdminFactories;
  consent: ConsentFactories;
  /** Mapa base (HU-301). */
  tiles: TilesFactories;
  /** M2 · HU-305 */
  routing: RoutingFactories;
}

/**
 * Monta los módulos sobre una app con el middleware de errores uniforme. Las pruebas pueden
 * pasar otras fábricas (p. ej. auth con repositorio en memoria y correo simulado).
 */
export function createApp(overrides: Partial<AppDeps> = {}) {
  const deps: AppDeps = {
    auth: overrides.auth ?? buildAuthFactories(),
    admin: overrides.admin ?? buildAdminFactories(),
    consent: overrides.consent ?? buildConsentFactories(),
    tiles: overrides.tiles ?? buildTilesFactories(),
    routing: overrides.routing ?? buildRoutingFactories(),
  };
  const app = createRouter();

  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  // Mapa base (HU-301): antes del CORS restringido porque /tiles tiene CORS abierto propio.
  app.route('/', tilesRoutes(deps.tiles));
  app.use('*', corsMiddleware());

  app.route('/', healthRoutes(buildGetHealth));
  app.route('/', authRoutes(deps.auth));
  app.route('/', meRoutes(deps.auth, requireAuth));
  app.route('/', adminRoutes(deps.admin, requireAuth));
  app.route('/', consentRoutes(deps.consent, requireAuth));
  // M2 · HU-305: GET /routes
  app.route('/', routingRoutes(deps.routing, requireAuth));

  app.openAPIRegistry.register('Error', ErrorSchema);
  // Esquema de seguridad de las rutas protegidas con requireAuth (/me, /admin…).
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });
  app.doc31('/openapi.json', (c) => ({
    openapi: '3.1.0',
    info: {
      title: 'PANTER API',
      version: c.env.APP_VERSION || 'dev',
      description: 'API REST de PANTER (Worker panter-api).',
    },
  }));

  return app;
}

const app = createApp();

export default app;
