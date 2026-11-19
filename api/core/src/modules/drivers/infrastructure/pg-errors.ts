/**
 * ¿El error es una violación de unicidad (SQLSTATE 23505) de esa restricción? Funciona con
 * neon-http (`constraint`) y postgres-js (`constraint_name`), y recorre `cause` porque Drizzle
 * envuelve el error del driver en un DrizzleQueryError.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown };
    if (e.code === '23505' && (e.constraint === constraint || e.constraint_name === constraint)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
