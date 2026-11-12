import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { Env } from '../src/env';

function envWithRealtime(fetch: Fetcher['fetch']): Env {
  return { ...env, REALTIME: { fetch } as Fetcher };
}

describe('GET /health', () => {
  it('responde servicio, versión, commit, entorno y el estado de realtime vía Service Binding', async () => {
    const res = await exports.default.fetch('https://api.test/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      service: 'panter-api',
      version: 'dev',
      commit: 'dev',
      environment: 'development',
      realtime: { status: 'ok', service: 'panter-realtime', version: 'test', commit: 'abc123' },
    });
  });

  it('toma versión y commit de las vars', async () => {
    const res = await app.request(
      '/health',
      {},
      { ...env, APP_VERSION: '1.2.3', GIT_COMMIT: 'deadbee', ENVIRONMENT: 'staging' },
    );
    const body = await res.json<Record<string, unknown>>();
    expect(body).toMatchObject({ version: '1.2.3', commit: 'deadbee', environment: 'staging' });
  });

  it('marca realtime como unreachable si el binding lanza, sin devolver 500', async () => {
    const res = await app.request(
      '/health',
      {},
      envWithRealtime(() => Promise.reject(new Error('no hay servicio'))),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ realtime: { status: 'unreachable' } });
  });

  it('marca realtime como unreachable si responde con error', async () => {
    const res = await app.request(
      '/health',
      {},
      envWithRealtime(async () => new Response('boom', { status: 503 })),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ realtime: { status: 'unreachable' } });
  });

  it('marca realtime como unreachable si no responde a tiempo', async () => {
    const started = Date.now();
    const res = await app.request(
      '/health',
      {},
      envWithRealtime(() => new Promise<Response>(() => {})),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ realtime: { status: 'unreachable' } });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('llama a https://realtime/health por el binding', async () => {
    const urls: string[] = [];
    await app.request(
      '/health',
      {},
      envWithRealtime(async (input) => {
        urls.push(input instanceof Request ? input.url : String(input));
        return Response.json({ service: 'panter-realtime', version: 'v', commit: 'c' });
      }),
    );
    expect(urls).toEqual(['https://realtime/health']);
  });
});
