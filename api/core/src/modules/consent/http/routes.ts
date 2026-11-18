import { createRoute } from '@hono/zod-openapi';
import {
  AcceptConsentBodySchema,
  ConsentRoutes,
  ConsentStatusSchema,
  PrivacyPolicyResponseSchema,
} from '@panter/contracts';
import type { MiddlewareHandler } from 'hono';
import type { AppBindings, Env } from '../../../env';
import { createRouter } from '../../../shared/http/create-app';
import { ErrorSchema } from '../../../shared/http/schemas';
import { getActor } from '../../auth/http/require-auth';
import {
  getPrivacyPolicy,
  type AcceptConsent,
  type GetConsentStatus,
} from '../application/consent';

/** Fábricas de los casos de uso de consentimiento (raíz de composición). */
export interface ConsentFactories {
  acceptConsent: (env: Env) => AcceptConsent;
  consentStatus: (env: Env) => GetConsentStatus;
}

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });

/** Rutas del aviso de privacidad y su aceptación (HU-109). */
export function consentRoutes(
  build: ConsentFactories,
  requireAuth: () => MiddlewareHandler<AppBindings>,
) {
  const acceptRoute = createRoute({
    method: 'post',
    path: ConsentRoutes.ME_CONSENT,
    tags: ['me'],
    summary: 'Aceptar el aviso de privacidad',
    description:
      'Registra la aceptación de la versión vigente del aviso (Ley 1581 de 2012) con fecha, IP y ' +
      'User-Agent. Idempotente. Si la versión enviada no es la vigente → 409.',
    security: [{ bearerAuth: [] }],
    middleware: [requireAuth()] as const,
    request: { body: { required: true, content: json(AcceptConsentBodySchema) } },
    responses: {
      200: { description: 'Estado del consentimiento', content: json(ConsentStatusSchema) },
      400: error('VALIDATION_ERROR: falta la versión o accepted no es true'),
      401: error('UNAUTHENTICATED o TOKEN_EXPIRED'),
      409: error('CONSENT_VERSION_OUTDATED (details.currentVersion)'),
    },
  });

  const policyRoute = createRoute({
    method: 'get',
    path: ConsentRoutes.PRIVACY_POLICY,
    tags: ['consent'],
    summary: 'Versión vigente del aviso de privacidad',
    description:
      'Público. El texto del aviso lo muestran la web y la app desde @panter/contracts ' +
      '(PRIVACY_POLICY); aquí solo se publica la versión vigente y desde cuándo rige.',
    responses: {
      200: { description: 'Versión vigente', content: json(PrivacyPolicyResponseSchema) },
    },
  });

  return createRouter()
    .openapi(acceptRoute, async (c) => {
      const status = await build.acceptConsent(c.env)({
        ...c.req.valid('json'),
        userId: getActor(c).userId,
        ip: c.req.header('CF-Connecting-IP'),
        userAgent: c.req.header('User-Agent'),
      });
      c.header('Cache-Control', 'no-store');
      return c.json(status, 200);
    })
    .openapi(policyRoute, (c) => {
      c.header('Cache-Control', 'public, max-age=300');
      return c.json(getPrivacyPolicy(), 200);
    });
}
