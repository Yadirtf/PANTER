import { createRoute, z } from '@hono/zod-openapi';
import {
  AuthRoutes,
  LogoutBodySchema,
  OtpRequestBodySchema,
  OtpRequestResponseSchema,
  OtpVerifyBodySchema,
  RefreshBodySchema,
  TokenPairResponseSchema,
} from '@panter/contracts';
import type { Env } from '../../../env';
import { createRouter } from '../../../shared/http/create-app';
import { ErrorSchema } from '../../../shared/http/schemas';
import type { RequestOtp } from '../application/request-otp';
import type { Logout, RefreshSession, SignInWithOtp } from '../application/session';

/** JWKS publicado: lo usa la web (middleware de Next.js) para verificar los access tokens. */
export interface Jwks {
  keys: { kty: string; kid: string; alg: string; use: string; n?: string; e?: string }[];
}

/**
 * Fábricas de los casos de uso (raíz de composición). Se llaman dentro de cada handler, así un
 * secreto que falta solo afecta al endpoint que lo usa.
 */
export interface AuthFactories {
  requestOtp: (env: Env) => RequestOtp;
  signIn: (env: Env) => SignInWithOtp;
  refresh: (env: Env) => RefreshSession;
  logout: (env: Env) => Logout;
  jwks: (env: Env) => () => Promise<Jwks>;
}

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });

const JwksSchema = z
  .object({
    keys: z.array(
      z
        .object({
          kty: z.string().openapi({ example: 'RSA' }),
          kid: z.string().openapi({ example: 'panter-staging-1' }),
          alg: z.string().openapi({ example: 'RS256' }),
          use: z.string().openapi({ example: 'sig' }),
          n: z.string().optional(),
          e: z.string().optional().openapi({ example: 'AQAB' }),
        })
        .loose(),
    ),
  })
  .openapi('Jwks');

const otpRequestRoute = createRoute({
  method: 'post',
  path: AuthRoutes.OTP_REQUEST,
  tags: ['auth'],
  summary: 'Pedir código de ingreso por correo',
  description:
    'Envía un código de 6 dígitos al correo (vigencia de 5 minutos). Responde siempre 202 con ' +
    'el mismo cuerpo, exista o no la cuenta. Máximo 3 códigos por correo cada 15 minutos.',
  request: { body: { required: true, content: json(OtpRequestBodySchema) } },
  responses: {
    202: { description: 'Código enviado', content: json(OtpRequestResponseSchema) },
    400: error('VALIDATION_ERROR: correo inválido'),
    429: error('OTP_RATE_LIMITED: demasiados códigos (details.retryAfterSeconds)'),
    503: error('EMAIL_DELIVERY_FAILED: el proveedor de correo no aceptó el envío'),
  },
});

const otpVerifyRoute = createRoute({
  method: 'post',
  path: AuthRoutes.OTP_VERIFY,
  tags: ['auth'],
  summary: 'Verificar el código e iniciar sesión',
  description:
    'Comprueba el código y emite el par de tokens (modo activo passenger). Si la cuenta no ' +
    'existe la crea con rol PASSENGER. El código es de un solo uso y admite 5 intentos.',
  request: { body: { required: true, content: json(OtpVerifyBodySchema) } },
  responses: {
    200: { description: 'Sesión iniciada', content: json(TokenPairResponseSchema) },
    400: error('VALIDATION_ERROR, OTP_INVALID (details.attemptsLeft) u OTP_EXPIRED'),
    403: error('ACCOUNT_SUSPENDED: cuenta suspendida o dada de baja'),
    429: error('OTP_TOO_MANY_ATTEMPTS: el código quedó invalidado'),
  },
});

const refreshRoute = createRoute({
  method: 'post',
  path: AuthRoutes.REFRESH,
  tags: ['auth'],
  summary: 'Renovar la sesión',
  description:
    'Rota el refresh token: el enviado queda revocado y se emite un par nuevo. Reutilizar un ' +
    'refresh token ya usado revoca toda la sesión.',
  request: { body: { required: true, content: json(RefreshBodySchema) } },
  responses: {
    200: { description: 'Par de tokens nuevo', content: json(TokenPairResponseSchema) },
    400: error('VALIDATION_ERROR'),
    401: error('REFRESH_TOKEN_INVALID: desconocido, vencido, ya usado o revocado'),
    403: error('ACCOUNT_SUSPENDED'),
  },
});

const logoutRoute = createRoute({
  method: 'post',
  path: AuthRoutes.LOGOUT,
  tags: ['auth'],
  summary: 'Cerrar sesión',
  description: 'Revoca el refresh token y su sesión. Responde 204 aunque el token no exista.',
  request: { body: { required: true, content: json(LogoutBodySchema) } },
  responses: {
    204: { description: 'Sesión cerrada' },
    400: error('VALIDATION_ERROR'),
  },
});

const jwksRoute = createRoute({
  method: 'get',
  path: AuthRoutes.JWKS,
  tags: ['auth'],
  summary: 'Llaves públicas para verificar los access tokens (JWKS)',
  responses: {
    200: { description: 'JWKS (RFC 7517)', content: json(JwksSchema) },
  },
});

/** Rutas HTTP del login. Sin lógica de negocio: validan, llaman al caso de uso y responden. */
export function authRoutes(build: AuthFactories) {
  return createRouter()
    .openapi(otpRequestRoute, async (c) => {
      const result = await build.requestOtp(c.env)(c.req.valid('json'));
      return c.json(result, 202);
    })
    .openapi(otpVerifyRoute, async (c) => {
      const pair = await build.signIn(c.env)(c.req.valid('json'));
      c.header('Cache-Control', 'no-store');
      return c.json(pair, 200);
    })
    .openapi(refreshRoute, async (c) => {
      const pair = await build.refresh(c.env)(c.req.valid('json'));
      c.header('Cache-Control', 'no-store');
      return c.json(pair, 200);
    })
    .openapi(logoutRoute, async (c) => {
      await build.logout(c.env)(c.req.valid('json'));
      return c.body(null, 204);
    })
    .openapi(jwksRoute, async (c) => {
      const jwks = await build.jwks(c.env)();
      c.header('Cache-Control', 'public, max-age=300');
      return c.json(jwks, 200);
    });
}
