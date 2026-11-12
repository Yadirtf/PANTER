import { createRoute, z } from '@hono/zod-openapi';
import type { Env } from '../../../env';
import { createRouter } from '../../../shared/http/create-app';
import type { GetHealth } from '../application/get-health';

const RealtimeSchema = z
  .union([
    z
      .object({
        status: z.literal('ok'),
        service: z.string().optional().openapi({ example: 'panter-realtime' }),
        version: z.string().optional().openapi({ example: 'dev' }),
        commit: z.string().optional().openapi({ example: 'dev' }),
      })
      .loose(),
    z.object({ status: z.literal('unreachable') }),
  ])
  .openapi('RealtimeHealth');

export const HealthSchema = z
  .object({
    service: z.string().openapi({ example: 'panter-api' }),
    version: z.string().openapi({ example: 'dev' }),
    commit: z.string().openapi({ example: 'dev' }),
    environment: z.string().openapi({ example: 'staging' }),
    realtime: RealtimeSchema,
  })
  .openapi('Health');

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['health'],
  summary: 'Estado del servicio',
  description:
    'Versión y commit desplegados, entorno y estado de panter-realtime. Siempre responde 200.',
  responses: {
    200: {
      description: 'Servicio en línea',
      content: { 'application/json': { schema: HealthSchema } },
    },
  },
});

/** Rutas HTTP del módulo health. El caso de uso se inyecta desde la raíz de composición. */
export function healthRoutes(makeGetHealth: (env: Env) => GetHealth) {
  return createRouter().openapi(healthRoute, async (c) => {
    const report = await makeGetHealth(c.env)();
    return c.json(report, 200);
  });
}
