import { createRoute } from '@hono/zod-openapi';
import {
  ActiveMode,
  AuthRoutes,
  MeResponseSchema,
  OtpRequestBodySchema,
  OtpRequestResponseSchema,
  OtpVerifyBodySchema,
} from '@panter/contracts';
import type { Env } from '../../../env';
import { createRouter } from '../../../shared/http/create-app';
import { ErrorSchema } from '../../../shared/http/schemas';
import type { RequestOtp } from '../application/request-otp';
import type { VerifyOtp } from '../application/verify-otp';
import { toProfile } from '../domain/user';

/**
 * Fábricas de los casos de uso (raíz de composición). Se llaman dentro de cada handler, así un
 * secreto que falta solo afecta al endpoint que lo usa.
 */
export interface AuthFactories {
  requestOtp: (env: Env) => RequestOtp;
  verifyOtp: (env: Env) => VerifyOtp;
}

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });

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
    'Comprueba el código. Si la cuenta no existe la crea con rol PASSENGER. El código es de un ' +
    'solo uso y admite 5 intentos.',
  request: { body: { required: true, content: json(OtpVerifyBodySchema) } },
  responses: {
    200: { description: 'Sesión iniciada', content: json(MeResponseSchema) },
    400: error('VALIDATION_ERROR, OTP_INVALID (details.attemptsLeft) u OTP_EXPIRED'),
    403: error('ACCOUNT_SUSPENDED: cuenta suspendida o dada de baja'),
    429: error('OTP_TOO_MANY_ATTEMPTS: el código quedó invalidado'),
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
      const user = await build.verifyOtp(c.env)(c.req.valid('json'));
      return c.json(toProfile(user, ActiveMode.PASSENGER), 200);
    });
}
