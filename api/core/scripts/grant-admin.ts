// Da el rol ADMIN a una cuenta existente, a partir de su correo (primer administrador, HU-108).
// Uso: DATABASE_URL=postgres://… pnpm --filter @panter/api-core db:grant-admin <correo>
//
// La cuenta debe existir: se crea la primera vez que la persona ingresa con su correo en la app
// o en la web. Es idempotente: si ya es ADMIN no cambia nada. Deja constancia en role_audit con
// actor_id NULL (lo hizo el sistema, no otro administrador). Sin DATABASE_URL no hace nada.
import postgres from 'postgres';
import { describeDatabaseUrl, hintForPostgresError } from './database-url.ts';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Uso: pnpm --filter @panter/api-core db:grant-admin <correo>');
  process.exit(2);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL (la cadena de conexión de la rama de Neon, p. ej. staging).');
  process.exit(1);
}
const summary = describeDatabaseUrl(url);
console.log(`DATABASE_URL: ${summary.description}`);
if (!summary.ok) {
  console.error('DATABASE_URL tiene problemas:');
  for (const problem of summary.problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const sql = postgres(url.trim(), { max: 1, onnotice: () => {} });

try {
  const [row] = await sql<{ id: string | null; inserted: number }[]>`
    WITH target AS (
      SELECT id FROM users WHERE lower(email) = ${email}
    ),
    inserted AS (
      INSERT INTO user_roles (user_id, role)
      SELECT id, 'ADMIN'::role FROM target
      ON CONFLICT (user_id, role) DO NOTHING
      RETURNING user_id
    ),
    audit AS (
      INSERT INTO role_audit (actor_id, user_id, role, action)
      SELECT NULL, user_id, 'ADMIN'::role, 'grant' FROM inserted
    )
    SELECT (SELECT id FROM target) AS id, (SELECT count(*) FROM inserted)::int AS inserted
  `;
  if (!row?.id) {
    console.error(
      `No existe una cuenta con el correo ${email}. Ingresa primero una vez en la app o en la web con ese correo (eso crea la cuenta) y vuelve a correr este comando.`,
    );
    process.exitCode = 1;
  } else if (row.inserted > 0) {
    console.log(
      `Listo: ${email} ahora tiene el rol ADMIN. Cierra sesión y vuelve a entrar en la web para verlo.`,
    );
  } else {
    console.log(`${email} ya tenía el rol ADMIN: no se cambió nada.`);
  }
} catch (error) {
  console.error('Error al otorgar el rol ADMIN:', error instanceof Error ? error.message : error);
  const hint = hintForPostgresError((error as { code?: string }).code);
  if (hint) console.error(`\n${hint}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
