import { buildAuthFactories } from './composition/auth';
import { buildGetHealth } from './composition/health';
import { authRoutes, type AuthFactories } from './modules/auth/http/routes';
import { healthRoutes } from './modules/health/http/routes';
import { createRouter } from './shared/http/create-app';
import { corsMiddleware } from './shared/http/cors';
import { errorHandler, notFoundHandler } from './shared/http/errors';
import { ErrorSchema } from './shared/http/schemas';

export interface AppDeps {
  auth: AuthFactories;
}

/**
 * Monta los módulos sobre una app con el middleware de errores uniforme. Las pruebas pueden
 * pasar otras fábricas (p. ej. auth con repositorio en memoria y correo simulado).
 */
export function createApp(deps: AppDeps = { auth: buildAuthFactories() }) {
  const app = createRouter();

  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  app.use('*', corsMiddleware());

  app.route('/', healthRoutes(buildGetHealth));
  app.route('/', authRoutes(deps.auth));

  app.openAPIRegistry.register('Error', ErrorSchema);
  // Esquema de seguridad para las rutas protegidas con requireAuth (HU-104 en adelante).
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
