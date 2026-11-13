import { cors } from 'hono/cors';
import type { AppBindings } from '../../env';
import type { MiddlewareHandler } from 'hono';

/** Convierte `CORS_ORIGINS` ("https://a, https://b") en una lista sin vacíos ni barras finales. */
export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * CORS para los clientes web (panter-web llama a panter-api desde otro dominio).
 * Solo se autorizan los orígenes de la var `CORS_ORIGINS` del ambiente; a cualquier otro no se
 * le envía `Access-Control-Allow-Origin` y el navegador bloquea la respuesta. La app móvil no
 * necesita CORS (no es un navegador).
 */
export function corsMiddleware(): MiddlewareHandler<AppBindings> {
  return cors({
    origin: (origin, c) =>
      parseAllowedOrigins((c.env as AppBindings['Bindings']).CORS_ORIGINS).includes(origin)
        ? origin
        : null,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'Accept'],
    credentials: true,
    maxAge: 600,
  });
}
