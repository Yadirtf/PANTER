import { buildAdminFactories } from './composition/admin';
import { buildAuthFactories, requireAuth, type IdentityFactories } from './composition/auth';
import { buildConsentFactories } from './composition/consent';
// HU-201/202/204: conductores
import { buildDriverFactories } from './composition/drivers';
import { driverRoutes, type DriverFactories } from './modules/drivers/http/routes';
import { makeRequireConsent } from './modules/consent/http/require-consent';
import { buildGetHealth } from './composition/health';
// M2 · HU-305 (rutas)
import { buildRoutingFactories } from './composition/routing';
import { routingRoutes, type RoutingFactories } from './modules/routing/http/routes';
import { adminRoutes, type AdminFactories } from './modules/admin/http/routes';
import { consentRoutes, type ConsentFactories } from './modules/consent/http/routes';
import { meRoutes } from './modules/auth/http/me-routes';
import { authRoutes } from './modules/auth/http/routes';
import { healthRoutes } from './modules/health/http/routes';
import { createRouter } from './shared/http/create-app';
import { corsMiddleware } from './shared/http/cors';
import { errorHandler, notFoundHandler } from './shared/http/errors';
import { ErrorSchema } from './shared/http/schemas';

export interface AppDeps {
  auth: IdentityFactories;
  admin: AdminFactories;
  consent: ConsentFactories;
  /** HU-201/202/204: conductores. */
  drivers: DriverFactories;
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
    drivers: overrides.drivers ?? buildDriverFactories(),
    routing: overrides.routing ?? buildRoutingFactories(),
  };
  const app = createRouter();

  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  app.use('*', corsMiddleware());

  app.route('/', healthRoutes(buildGetHealth));
  app.route('/', authRoutes(deps.auth));
  app.route('/', meRoutes(deps.auth, requireAuth));
  app.route('/', adminRoutes(deps.admin, requireAuth));
  app.route('/', consentRoutes(deps.consent, requireAuth));
  // HU-201/202/204: conductores (solicitud, documentos y revisión por ADMIN).
  const requireConsent = makeRequireConsent(deps.consent.consentStatus);
  app.route('/', driverRoutes(deps.drivers, { requireAuth, requireConsent }));
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
