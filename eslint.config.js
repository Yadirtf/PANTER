// Configuración ESLint compartida por todo el monorepo (flat config).
// Las reglas de fronteras hacen cumplir la Clean Architecture (Docs/adr/0001).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const INFRA_LIBS = [
  'hono',
  'hono/*',
  '@hono/*',
  'drizzle-orm',
  'drizzle-orm/*',
  '@neondatabase/*',
  'cloudflare:*',
  'jose',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.wrangler/**',
      '**/.next/**',
      '**/.open-next/**',
      '**/android/**',
      '**/ios/**',
      '**/worker-configuration.d.ts',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // Capa de dominio: TypeScript puro. Solo puede depender de sí misma y de @panter/contracts.
  {
    files: ['**/modules/*/domain/**/*.ts', '**/shared/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/application/**', '**/infrastructure/**', '**/http/**'],
              message: 'El dominio no puede depender de capas externas (ADR 0001).',
            },
            {
              group: INFRA_LIBS,
              message: 'El dominio no puede usar librerías de infraestructura.',
            },
          ],
        },
      ],
    },
  },
  // Capa de aplicación: casos de uso y puertos. No conoce adaptadores ni HTTP.
  {
    files: ['**/modules/*/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/infrastructure/**', '**/http/**'],
              message: 'La aplicación depende de puertos, no de adaptadores (ADR 0001).',
            },
            {
              group: INFRA_LIBS,
              message: 'La aplicación no puede usar librerías de infraestructura.',
            },
          ],
        },
      ],
    },
  },
  // packages/contracts es compartido por app, web y api: debe ser puro.
  {
    files: ['packages/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...INFRA_LIBS, 'react', 'react-native', 'next', 'next/*', 'expo*'],
              message: 'contracts solo contiene código puro y esquemas Zod.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
