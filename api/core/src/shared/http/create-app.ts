import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppBindings } from '../../env';
import { validationErrorResponse } from './errors';

/**
 * Crea una instancia de OpenAPIHono cuya validación Zod responde con el formato de error
 * uniforme. Úsala para la app raíz y para los routers de cada módulo.
 */
export function createRouter(): OpenAPIHono<AppBindings> {
  return new OpenAPIHono<AppBindings>({
    defaultHook: (result, c) => {
      if (!result.success) return validationErrorResponse(c, result.error);
      return undefined;
    },
  });
}
