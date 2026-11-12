import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` compara el esquema con ./drizzle/meta y escribe una migración SQL nueva;
// no necesita base de datos. `pnpm db:migrate` NO usa drizzle-kit: corre scripts/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/shared/infrastructure/db/schema/index.ts',
  out: './drizzle',
  // Solo para comandos que se conectan (`drizzle-kit studio`, `introspect`).
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  // Ignora las tablas propias de PostGIS (spatial_ref_sys) al introspectar.
  extensionsFilters: ['postgis'],
  strict: true,
  verbose: true,
});
