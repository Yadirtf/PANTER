import { Role } from '@panter/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { parsePolygon } from '../../../shared/infrastructure/db/geography-polygon';

/** `actor_ok`: quien edita sigue siendo ADMIN con la cuenta ACTIVE (manda la base de datos). */
export const actorIsAdminCte = (actorId: string) => sql`
  actor_ok AS (
    SELECT EXISTS (
      SELECT 1 FROM user_roles r JOIN users u ON u.id = r.user_id
      WHERE r.user_id = ${actorId}::uuid AND r.role = ${Role.ADMIN}::role AND u.status = 'ACTIVE'
    ) AS ok
  )`;

/** Columna timestamptz como ISO 8601 en UTC con microsegundos (cursores estables). */
export const isoMicros = (column: SQL | unknown) =>
  sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Columna timestamptz como ISO 8601 en UTC con milisegundos (lo que valida `z.iso.datetime`). */
export const isoMillis = (column: string) =>
  sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** Snapshot JSON de un barrio para `catalog_changes`; el polígono va como GeoJSON. */
export const areaJson = (t: string) =>
  sql.raw(`jsonb_build_object(
    'name', ${t}.name, 'kind', ${t}.kind, 'polygon', ST_AsGeoJSON(${t}.polygon)::jsonb,
    'source', ${t}.source, 'active', ${t}.active)`);

/**
 * CTE `relink`: recalcula `places.area_id` de los lugares afectados por los barrios de la CTE
 * `changed` (id, polygon, active, con los valores NUEVOS). Afectados = los que estaban en uno de
 * esos barrios o quedan dentro de su nuevo polígono. El barrio de cada lugar es el activo de
 * menor área que lo cubre (`ST_Covers`), igual que GET /areas/locate. Dentro de la misma
 * sentencia `areas` aún tiene los valores anteriores, por eso los cambiados salen de `changed`.
 */
export const relinkPlacesCte = (changed: string) =>
  sql.raw(`
  relink AS (
    UPDATE places p SET area_id = (
      SELECT c.id FROM (
        SELECT a.id, a.polygon FROM areas a
        WHERE a.active AND a.id NOT IN (SELECT id FROM ${changed})
        UNION ALL
        SELECT ch.id, ch.polygon FROM ${changed} ch WHERE ch.active
      ) c
      WHERE ST_Covers(c.polygon, p.location)
      ORDER BY ST_Area(c.polygon), c.id
      LIMIT 1
    )
    FROM (
      SELECT DISTINCT p2.id FROM places p2 JOIN ${changed} ch2
        ON p2.area_id = ch2.id OR ST_Covers(ch2.polygon, p2.location)
    ) affected
    WHERE p.id = affected.id
    RETURNING p.id
  )`);

/**
 * ¿El error es una violación de unicidad (SQLSTATE 23505) de esa restricción? Funciona con
 * postgres-js y con el driver HTTP de Neon, también envuelto por Drizzle (`cause`).
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown };
    if (e.code === '23505' && (e.constraint === constraint || e.constraint_name === constraint)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

type Snapshot = Record<string, unknown>;

/**
 * Los polígonos se guardan en `catalog_changes` como GeoJSON (`ST_AsGeoJSON`) y los puntos
 * como GeoJSON Point; la API los devuelve en el formato `{ lat, lng }` del resto del catálogo.
 */
export function presentSnapshot(value: unknown): Snapshot | null {
  if (value === null || typeof value !== 'object') return null;
  const snapshot = { ...(value as Snapshot) };
  for (const [key, v] of Object.entries(snapshot)) {
    const geo = v as { type?: unknown; coordinates?: unknown } | null;
    if (!geo || typeof geo !== 'object' || !Array.isArray(geo.coordinates)) continue;
    if (geo.type === 'Polygon') {
      try {
        snapshot[key] = parsePolygon(geo);
      } catch {
        // Un snapshot con otro formato se devuelve tal cual.
      }
    } else if (geo.type === 'Point') {
      const [lng, lat] = geo.coordinates as unknown[];
      if (typeof lng === 'number' && typeof lat === 'number') snapshot[key] = { lat, lng };
    }
  }
  return snapshot;
}
