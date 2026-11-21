import { buildAdminFactories } from './composition/admin';
import { buildAuthFactories, requireAuth, type IdentityFactories } from './composition/auth';
import { buildConsentFactories } from './composition/consent';
// HU-201/202/204: conductores
import { buildAdminDriverFactories, buildDriverFactories } from './composition/drivers';
import { adminDriverRoutes, type AdminDriverFactories } from './modules/drivers/http/admin-routes';
import { driverRoutes, type DriverFactories } from './modules/drivers/http/routes';
import { makeRequireConsent } from './modules/consent/http/require-consent';
import { buildGetHealth } from './composition/health';
import { buildTilesFactories } from './composition/tiles';
// M2 · HU-305 (rutas)
import { buildRoutingFactories } from './composition/routing';
import { routingRoutes, type RoutingFactories } from './modules/routing/http/routes';
// M2 · HU-401 (tarifas y geocercas)
// M2 · HU-402 (estimado)
import { buildPricingAdminFactories, buildPricingFactories } from './composition/pricing';
import { pricingRoutes, type PricingFactories } from './modules/pricing/http/routes';
import {
  pricingAdminRoutes,
  type PricingAdminFactories,
} from './modules/pricing/http/admin-routes';
// E15 · HU-308 (barrios y veredas)
import { buildAreaFactories } from './composition/catalog';
import { areaRoutes, type AreaFactories } from './modules/catalog/http/area-routes';
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
  /** HU-201/202/204: conductores. */
  drivers: DriverFactories;
  /** HU-204: revisión por ADMIN. */
  adminDrivers: AdminDriverFactories;
  /** M2 · HU-305 */
  routing: RoutingFactories;
  /** M2 · HU-401 */
  pricingAdmin: PricingAdminFactories;
  /** M2 · HU-402 */
  pricing: PricingFactories;
  /** E15 · HU-308 */
  areas: AreaFactories;
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
    drivers: overrides.drivers ?? buildDriverFactories(),
    adminDrivers: overrides.adminDrivers ?? buildAdminDriverFactories(),
    routing: overrides.routing ?? buildRoutingFactories(),
    pricingAdmin: overrides.pricingAdmin ?? buildPricingAdminFactories(),
    pricing: overrides.pricing ?? buildPricingFactories(),
    areas: overrides.areas ?? buildAreaFactories(),
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
  // HU-201/202/204: conductores (solicitud, documentos y revisión por ADMIN).
  const requireConsent = makeRequireConsent(deps.consent.consentStatus);
  app.route('/', driverRoutes(deps.drivers, { requireAuth, requireConsent }));
  app.route('/', adminDriverRoutes(deps.adminDrivers, requireAuth));
  // M2 · HU-305: GET /routes
  app.route('/', routingRoutes(deps.routing, requireAuth));
  // M2 · HU-401: /admin/fares
  app.route('/', pricingAdminRoutes(deps.pricingAdmin, requireAuth));
  // M2 · HU-402: POST /fares/estimate
  app.route('/', pricingRoutes(deps.pricing, requireAuth));
  // E15 · HU-308: /areas y /admin/areas
  app.route('/', areaRoutes(deps.areas, requireAuth));

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
