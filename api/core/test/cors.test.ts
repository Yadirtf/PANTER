import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { parseAllowedOrigins } from '../src/shared/http/cors';

const WEB = 'https://panter-web-staging.panter.workers.dev';
const stagingEnv = { ...env, CORS_ORIGINS: `${WEB}, http://localhost:3000/` };

describe('CORS', () => {
  it('normaliza la lista de orígenes', () => {
    expect(parseAllowedOrigins(' https://a.dev/ ,, https://b.dev ')).toEqual([
      'https://a.dev',
      'https://b.dev',
    ]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });

  it('autoriza el origen de la web en una petición normal', async () => {
    const res = await app.request('/health', { headers: { Origin: WEB } }, stagingEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('responde el preflight OPTIONS con métodos y cabeceras permitidos', async () => {
    const res = await app.request(
      '/health',
      {
        method: 'OPTIONS',
        headers: {
          Origin: WEB,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type',
        },
      },
      stagingEnv,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'authorization',
    );
  });

  it('acepta orígenes de la lista aunque se configuren con barra final', async () => {
    const res = await app.request(
      '/health',
      { headers: { Origin: 'http://localhost:3000' } },
      stagingEnv,
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  it('no autoriza orígenes desconocidos', async () => {
    const res = await app.request(
      '/health',
      { headers: { Origin: 'https://sitio-malicioso.example' } },
      stagingEnv,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('las respuestas de error también llevan CORS', async () => {
    const res = await app.request('/no-existe', { headers: { Origin: WEB } }, stagingEnv);
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB);
  });
});
