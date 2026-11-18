import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;

/**
 * Cliente Drizzle sobre el driver HTTP de Neon (`fetch`, sin sockets TCP), apto para Workers.
 *
 * Se crea por request desde `env.DATABASE_URL` en la raíz de composición y se pasa a los
 * repositorios de `infrastructure`. No se guarda en una variable global del módulo: en Workers
 * el aislado se reutiliza entre requests y los secretos solo llegan en `env`.
 * El driver HTTP no admite transacciones interactivas; si un caso de uso las necesita, usar
 * `drizzle-orm/neon-serverless` (WebSocket) con un `Pool` creado y cerrado dentro del request.
 */
export function createDb(databaseUrl: string | undefined) {
  if (!databaseUrl?.trim()) {
    throw new Error(
      'DATABASE_URL no está configurada en el Worker: cárgala como Secret (Cloudflare → Settings → Variables and Secrets) o con `wrangler secret put DATABASE_URL`.',
    );
  }
  const url = databaseUrl.trim();
  if (!/^postgres(ql)?:\/\/[^\s'"]+$/.test(url)) {
    throw new Error(
      'DATABASE_URL del Worker no es una cadena de conexión válida (debe empezar por postgresql://, sin comillas ni psql).',
    );
  }
  return drizzle({ client: neon(url), schema });
}
