import { buildGetHealth } from './composition/health';
import { healthRoutes } from './modules/health/http/routes';
import { createRouter } from './shared/http/create-app';
import { corsMiddleware } from './shared/http/cors';
import { errorHandler, notFoundHandler } from './shared/http/errors';
import { ErrorSchema } from './shared/http/schemas';

/** Monta los módulos sobre una app con el middleware de errores uniforme. */
export function createApp() {
  const app = createRouter();

  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  app.use('*', corsMiddleware());

  app.route('/', healthRoutes(buildGetHealth));

  app.openAPIRegistry.register('Error', ErrorSchema);
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
