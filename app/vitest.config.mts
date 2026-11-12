import { defineConfig } from 'vitest/config';

// Solo se prueban módulos puros (configuración y navegación); los componentes RN quedan fuera.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
