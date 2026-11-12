import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Las pruebas corren dentro de workerd con los bindings de wrangler.jsonc simulados por
// Miniflare (KV, R2 y Queue locales). El service binding REALTIME apunta a un Worker
// auxiliar "panter-realtime" que imita el contrato de GET /health de api/realtime.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        workers: [
          {
            name: 'panter-realtime',
            modules: true,
            compatibilityDate: '2026-08-15',
            script: `export default {
              fetch(request) {
                const url = new URL(request.url);
                if (url.pathname === '/health') {
                  return Response.json({ service: 'panter-realtime', version: 'test', commit: 'abc123' });
                }
                return new Response('not found', { status: 404 });
              },
            };`,
          },
        ],
      },
    }),
  ],
});
