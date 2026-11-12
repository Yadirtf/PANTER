import { describe, expect, it, vi } from 'vitest';
import { createHttpClient } from '@/shared/api/http-client';
import { getHealth } from './get-health';

describe('getHealth', () => {
  it('llama a GET /health de la URL configurada y valida la respuesta', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: 'ok', service: 'panter-api' }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const client = createHttpClient({ baseUrl: 'https://api.test', fetch: fetchMock });

    await expect(getHealth({}, client)).resolves.toEqual({ status: 'ok', service: 'panter-api' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.test/health');
  });
});
