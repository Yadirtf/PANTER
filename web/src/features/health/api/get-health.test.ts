import { describe, expect, it, vi } from 'vitest';
import { ClientErrorCode } from '@/shared/api/errors';
import { createHttpClient } from '@/shared/api/http-client';
import { getHealth } from './get-health';

const API_HEALTH = {
  service: 'panter-api',
  version: '0.1.0',
  commit: '0049aa8',
  environment: 'staging',
  realtime: { service: 'panter-realtime', version: '0.1.0', commit: 'e970049', status: 'ok' },
};

function clientReturning(body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
    ),
  );
  return { fetchMock, client: createHttpClient({ baseUrl: 'https://api.test', fetch: fetchMock }) };
}

describe('getHealth', () => {
  it('llama a GET /health y acepta la respuesta real de panter-api', async () => {
    const { fetchMock, client } = clientReturning(API_HEALTH);

    await expect(getHealth({}, client)).resolves.toEqual(API_HEALTH);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.test/health');
  });

  it('acepta realtime caído', async () => {
    const { client } = clientReturning({ ...API_HEALTH, realtime: { status: 'unreachable' } });

    await expect(getHealth({}, client)).resolves.toMatchObject({
      realtime: { status: 'unreachable' },
    });
  });

  it('rechaza una respuesta que no cumple el contrato', async () => {
    const { client } = clientReturning({ status: 'ok' });

    await expect(getHealth({}, client)).rejects.toMatchObject({
      code: ClientErrorCode.INVALID_RESPONSE,
    });
  });
});
