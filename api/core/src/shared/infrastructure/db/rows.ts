/** Filas de `db.execute(sql)`: `{ rows }` con neon-http y un arreglo con postgres-js. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] } | null)?.rows ?? [];
}
