import { HealthResponseSchema } from '@panter/contracts';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import app from '../src/index';

// Si la respuesta de /health cambia sin actualizar @panter/contracts, la web y la app dejan
// de poder leerla (en staging se vio como "API no disponible (INVALID_RESPONSE)").
const realtimeDown: Fetcher['fetch'] = () => Promise.reject(new Error('caído'));

describe('GET /health cumple el contrato de @panter/contracts', () => {
  it('con realtime en línea', async () => {
    const res = await exports.default.fetch('https://api.test/health');
    const parsed = HealthResponseSchema.safeParse(await res.json());

    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.realtime.status).toBe('ok');
  });

  it('con realtime caído', async () => {
    const res = await app.request(
      '/health',
      {},
      { ...env, REALTIME: { fetch: realtimeDown } as Fetcher },
    );
    const parsed = HealthResponseSchema.safeParse(await res.json());

    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.realtime.status).toBe('unreachable');
  });
});
