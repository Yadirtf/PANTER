// Aplica las migraciones SQL versionadas de ./drizzle sobre DATABASE_URL.
// Uso: DATABASE_URL=postgres://… pnpm db:migrate
//
// Corre en Node (no en Workers) con el driver TCP `postgres`, que sirve igual contra Neon
// (cadena con `sslmode=require`) que contra un PostgreSQL/PostGIS local o el contenedor de CI.
// Drizzle registra lo aplicado en `drizzle.__drizzle_migrations`; volver a correrlo no hace nada.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL (p. ej. postgres://postgres:postgres@localhost:5432/panter).');
  process.exit(1);
}

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const client = postgres(url, { max: 1, onnotice: () => {} });

try {
  await migrate(drizzle({ client }), { migrationsFolder });
  console.log(`Migraciones aplicadas desde ${migrationsFolder}`);
} catch (error) {
  console.error('Error aplicando migraciones:', error);
  process.exitCode = 1;
} finally {
  await client.end();
}
