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
  if (!databaseUrl) throw new Error('DATABASE_URL no está configurada');
  return drizzle({ client: neon(databaseUrl), schema });
}
