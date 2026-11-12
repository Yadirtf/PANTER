import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('GET /openapi.json', () => {
  it('publica el documento OpenAPI 3.1 con /health y el esquema de error', async () => {
    const res = await exports.default.fetch('https://api.test/openapi.json');
    expect(res.status).toBe(200);
    const doc = await res.json<{
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    }>();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toMatchObject({ title: 'PANTER API', version: env.APP_VERSION });
    expect(doc.paths).toHaveProperty('/health');
    expect(doc.components.schemas).toHaveProperty('Health');
    expect(doc.components.schemas).toHaveProperty('Error');
  });
});

describe('bindings declarados', () => {
  it('KV, R2, Queue y REALTIME existen en el entorno', () => {
    expect(env.KV).toBeDefined();
    expect(env.DOCUMENTS).toBeDefined();
    expect(env.EVENTS).toBeDefined();
    expect(env.REALTIME).toBeDefined();
  });
});
