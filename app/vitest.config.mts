import { defineConfig } from 'vitest/config';

// Solo se prueban módulos puros (configuración, navegación y plugins de Expo);
// los componentes RN quedan fuera.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['app.config.test.ts', 'src/**/*.test.ts', 'plugins/**/*.test.ts'],
  },
});
