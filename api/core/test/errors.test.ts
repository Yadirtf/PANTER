import { createRoute, z } from '@hono/zod-openapi';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/shared/errors/app-error';
import { createRouter } from '../src/shared/http/create-app';
import { errorHandler, notFoundHandler } from '../src/shared/http/errors';

function testApp() {
  const app = createRouter();
  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.openapi(
    createRoute({
      method: 'post',
      path: '/echo',
      request: {
        body: {
          content: { 'application/json': { schema: z.object({ name: z.string().min(2) }) } },
        },
      },
      responses: { 200: { description: 'ok' } },
    }),
    (c) => c.json(c.req.valid('json'), 200),
  );
  app.get('/app-error', () => {
    throw new AppError('TRIP_NOT_FOUND', 'Viaje no encontrado', {
      status: 404,
      details: { tripId: 't1' },
    });
  });
  app.get('/boom', () => {
    throw new Error('secreto interno');
  });
  return app;
}

describe('formato uniforme de errores', () => {
  it('404 de la app real con { error: { code, message } }', async () => {
    const res = await exports.default.fetch('https://api.test/no-existe');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Ruta no encontrada: GET /no-existe' },
    });
  });

  it('error de validación Zod con details por campo', async () => {
    const res = await testApp().request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'a' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: { code: string; details: { path: string }[] } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual([expect.objectContaining({ path: 'name' })]);
  });

  it('JSON malformado sale en el mismo formato', async () => {
    const res = await testApp().request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(typeof body.error.message).toBe('string');
  });

  it('AppError conserva código, estado y details', async () => {
    const res = await testApp().request('/app-error');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'TRIP_NOT_FOUND', message: 'Viaje no encontrado', details: { tripId: 't1' } },
    });
  });

  it('errores no controlados son 500 sin filtrar el mensaje interno', async () => {
    const res = await testApp().request('/boom');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' },
    });
  });
});
