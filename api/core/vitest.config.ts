import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Las pruebas corren dentro de workerd con los bindings de wrangler.jsonc simulados por
// Miniflare (KV, R2 y Queue locales). El service binding REALTIME apunta a un Worker
// auxiliar "panter-realtime" que imita el contrato de GET /health de api/realtime.
// Solo test/: las pruebas de integración (test-integration/) corren en Node con
// vitest.integration.config.ts.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        workers: [
          {
            name: 'panter-realtime',
            modules: true,
            compatibilityDate: '2026-11-01',
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
