import type { Env } from '../env';
import { createDb, type Database } from '../shared/infrastructure/db';

/**
 * Cliente de base de datos del request actual. Se llama dentro del handler (nunca al cargar el
 * módulo) y el resultado se inyecta en los repositorios de `infrastructure` de cada módulo.
 */
export function buildDb(env: Pick<Env, 'DATABASE_URL'>): Database {
  return createDb(env.DATABASE_URL);
}
