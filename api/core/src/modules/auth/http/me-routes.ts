import { createRoute } from '@hono/zod-openapi';
import {
  AuthRoutes,
  MeResponseSchema,
  SwitchModeBodySchema,
  SwitchModeResponseSchema,
} from '@panter/contracts';
import type { MiddlewareHandler } from 'hono';
import type { AppBindings, Env } from '../../../env';
import { createRouter } from '../../../shared/http/create-app';
import { ErrorSchema } from '../../../shared/http/schemas';
import type { GetMe, SwitchMode } from '../application/me';
import { getActor } from './require-auth';

/** Fábricas de los casos de uso de la sesión actual (raíz de composición). */
export interface MeFactories {
  getMe: (env: Env) => GetMe;
  switchMode: (env: Env) => SwitchMode;
}

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });
const security = [{ bearerAuth: [] }];

const authErrors = {
  401: error('UNAUTHENTICATED o TOKEN_EXPIRED'),
  403: error('ACCOUNT_SUSPENDED'),
};

/** Rutas de la sesión actual (HU-104). Todas exigen `Authorization: Bearer <access token>`. */
export function meRoutes(build: MeFactories, requireAuth: () => MiddlewareHandler<AppBindings>) {
  const meRoute = createRoute({
    method: 'get',
    path: AuthRoutes.ME,
    tags: ['me'],
    summary: 'Perfil de la sesión actual',
    description: 'Perfil, roles actuales (de la base de datos) y modo activo del access token.',
    security,
    middleware: [requireAuth()] as const,
    responses: {
      200: { description: 'Perfil', content: json(MeResponseSchema) },
      ...authErrors,
    },
  });

  const switchModeRoute = createRoute({
    method: 'post',
    path: AuthRoutes.ME_MODE,
    tags: ['me'],
    summary: 'Cambiar de modo (pasajero o conductor)',
    description:
      'Emite un par de tokens nuevo con el modo pedido; el refresh token anterior queda rotado. ' +
      'El modo driver exige el rol DRIVER. No se puede cambiar con un viaje en curso. Al pasar a ' +
      'passenger el conductor queda no disponible.',
    security,
    middleware: [requireAuth()] as const,
    request: { body: { required: true, content: json(SwitchModeBodySchema) } },
    responses: {
      200: { description: 'Par de tokens nuevo', content: json(SwitchModeResponseSchema) },
      400: error('VALIDATION_ERROR: modo inválido'),
      401: error('UNAUTHENTICATED, TOKEN_EXPIRED o REFRESH_TOKEN_INVALID (sesión cerrada)'),
      403: error('MODE_NOT_ALLOWED (driver sin el rol DRIVER) o ACCOUNT_SUSPENDED'),
      409: error('MODE_CHANGE_ACTIVE_TRIP: hay un viaje en curso'),
    },
  });

  return createRouter()
    .openapi(meRoute, async (c) => {
      const profile = await build.getMe(c.env)(getActor(c));
      c.header('Cache-Control', 'no-store');
      return c.json(profile, 200);
    })
    .openapi(switchModeRoute, async (c) => {
      const pair = await build.switchMode(c.env)(getActor(c), c.req.valid('json'));
      c.header('Cache-Control', 'no-store');
      return c.json(pair, 200);
    });
}
