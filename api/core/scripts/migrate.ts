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
import { describeDatabaseUrl, hintForPostgresError } from './database-url.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL (p. ej. postgres://postgres:postgres@localhost:5432/panter).');
  process.exit(1);
}

const summary = describeDatabaseUrl(url);
console.log(`DATABASE_URL: ${summary.description}`);
if (!summary.ok) {
  console.error('DATABASE_URL tiene problemas:');
  for (const problem of summary.problems) console.error(`  - ${problem}`);
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::error title=DATABASE_URL inválida::${summary.problems.join('; ')}`);
  }
  process.exit(1);
}

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const client = postgres(url, { max: 1, onnotice: () => {} });

try {
  await migrate(drizzle({ client }), { migrationsFolder });
  console.log(`Migraciones aplicadas desde ${migrationsFolder}`);
} catch (error) {
  console.error('Error aplicando migraciones:', error);
  const cause = (error as { cause?: { code?: string }; code?: string }) ?? {};
  const hint = hintForPostgresError(cause.cause?.code ?? cause.code);
  if (hint) {
    console.error(`\n${hint}`);
    if (process.env.GITHUB_ACTIONS) {
      console.log(`::error title=Conexión a Neon rechazada::${hint.split('\n')[0]}`);
    }
  }
  process.exitCode = 1;
} finally {
  await client.end();
}
