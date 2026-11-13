import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from './health';

const ok = {
  service: 'panter-api',
  version: '0.1.0',
  commit: 'abc',
  environment: 'staging',
  realtime: { service: 'panter-realtime', version: '0.1.0', commit: 'def', status: 'ok' },
};

describe('HealthResponseSchema', () => {
  it('acepta la respuesta real de panter-api', () => {
    expect(HealthResponseSchema.parse(ok)).toEqual(ok);
  });

  it('acepta realtime caído', () => {
    const res = HealthResponseSchema.parse({ ...ok, realtime: { status: 'unreachable' } });
    expect(res.realtime.status).toBe('unreachable');
  });

  it('ignora campos adicionales', () => {
    expect(HealthResponseSchema.parse({ ...ok, extra: 1 })).not.toHaveProperty('extra');
  });

  it('rechaza respuestas sin los campos obligatorios', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
    expect(HealthResponseSchema.safeParse({ ...ok, realtime: { status: 'down' } }).success).toBe(
      false,
    );
  });
});
