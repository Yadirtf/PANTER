import { defineConfig } from 'vitest/config';

// Pruebas de integración contra PostgreSQL + PostGIS reales, en Node (fuera del pool de Workers).
// Requieren DATABASE_URL con las migraciones aplicadas (`pnpm db:migrate`); sin ella se omiten.
export default defineConfig({
  test: {
    include: ['test-integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    fileParallelism: false,
    // Cobertura de los repositorios Drizzle (excluidos de `pnpm test`, que no tiene base de datos).
    coverage: {
      provider: 'istanbul',
      include: ['src/**/infrastructure/drizzle-*.ts'],
      reporter: ['text'],
      thresholds: { statements: 90, branches: 80, functions: 90, lines: 90 },
    },
  },
});
