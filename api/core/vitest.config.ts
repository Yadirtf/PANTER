import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Dos proyectos:
// - unit (test/unit/): dominio y casos de uso con dobles en memoria, en Node. No usan bindings,
//   workerd ni base de datos (ADR 0001).
// - workers (resto de test/): rutas, adaptadores y raíz de composición dentro de workerd, con los
//   bindings de wrangler.jsonc simulados por Miniflare (KV, R2 y Queue locales). El service
//   binding REALTIME apunta a un Worker auxiliar "panter-realtime" que imita el contrato de
//   GET /health de api/realtime.
// Las pruebas de integración (test-integration/) corren en Node con vitest.integration.config.ts.
//
// Cobertura con @vitest/coverage-istanbul: istanbul instrumenta el código al transformarlo, así
// que funciona también dentro de workerd (coverage-v8 no, porque necesita el inspector de Node).
// Los umbrales por carpeta hacen fallar `pnpm test` si baja la cobertura de auth y email.
const CRITICAL = { statements: 90, branches: 85, functions: 90, lines: 90 };

export default defineConfig({
  test: {
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      // Los repositorios Drizzle se miden en test:integration, contra Postgres real.
      exclude: ['src/**/infrastructure/drizzle-*.ts'],
      reporter: ['text-summary', 'text', 'html'],
      thresholds: {
        'src/modules/email/**': CRITICAL,
        'src/modules/auth/**': CRITICAL,
      },
    },
    projects: [
      {
        test: { name: 'unit', include: ['test/unit/**/*.test.ts'], environment: 'node' },
      },
      {
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
        test: { name: 'workers', include: ['test/**/*.test.ts'], exclude: ['test/unit/**'] },
      },
    ],
  },
});
