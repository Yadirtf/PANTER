import type { Geofence, GeofenceKind } from '@panter/contracts';
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { polygonToEwkt } from '../../../shared/infrastructure/db/geography-polygon';
import { toEwkt } from '../../../shared/infrastructure/db/geography';
import { rowsOf } from '../../../shared/infrastructure/db/rows';
import { geofences } from '../../../shared/infrastructure/db/schema';
import type { AnyPgDatabase } from '../../auth/infrastructure/drizzle-user-repository';
import type { GeofenceHit, GeofenceRepository } from '../application/ports';
import { actorIsAdminCte, runEdit } from './drizzle-fare-sql';

/** Snapshot JSON de una geocerca para `fare_changes`; el polígono va como GeoJSON. */
const geofenceJson = (t: string) =>
  sql.raw(`jsonb_build_object(
    'name', ${t}.name, 'kind', ${t}.kind, 'polygon', ST_AsGeoJSON(${t}.area)::jsonb,
    'surcharge', ${t}.surcharge, 'appliesTo', to_jsonb(${t}.applies_to), 'active', ${t}.active)`);

/** Arreglo de Postgres `{TAXI,MOTOTAXI}` (valores ya validados contra el enum). */
const pgArray = (values: readonly string[]) => `{${values.join(',')}}`;

interface HitRow {
  id: string;
  name: string;
  kind: GeofenceKind;
  surcharge: number;
}

/**
 * Repositorio de `geofences` (HU-401) sobre PostGIS.
 * - `findCovering`: `ST_Covers(area, punto::geography)` para el origen y el destino; con el
 *   OR el planificador combina dos búsquedas en el índice GIST `geofences_area_gist`.
 * - `update`: una sola sentencia que comprueba al actor, valida el polígono con `ST_IsValid`,
 *   bloquea la fila, actualiza si algo cambió y escribe en `fare_changes`.
 */
export function createDrizzleGeofenceRepository(db: AnyPgDatabase): GeofenceRepository {
  async function select(where?: SQL): Promise<Geofence[]> {
    const rows = await db
      .select()
      .from(geofences)
      .where(where)
      .orderBy(asc(geofences.kind), asc(geofences.name));
    return rows.map((g) => ({
      id: g.id,
      name: g.name,
      kind: g.kind,
      polygon: g.area.map((ring) => [...ring]),
      surcharge: g.surcharge,
      appliesTo: g.appliesTo,
      active: g.active,
    }));
  }

  return {
    list: () => select(),
    get: async (id) => (await select(eq(geofences.id, id)))[0] ?? null,

    async findCovering({ origin, destination, vehicleType }): Promise<GeofenceHit[]> {
      const o = toEwkt(origin);
      const d = toEwkt(destination);
      const rows = await db.execute(sql`
        SELECT id, name, kind, surcharge FROM geofences
        WHERE active AND ${vehicleType}::vehicle_type = ANY (applies_to)
          AND (ST_Covers(area, ${o}::geography) OR ST_Covers(area, ${d}::geography))
        ORDER BY kind, name
      `);
      return rowsOf<HitRow>(rows).map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        surcharge: Number(r.surcharge),
      }));
    },

    update: ({ id, actorId, geofence: g }) => {
      // Sin polígono se conserva el actual (NULL en SQL → COALESCE con old.area).
      const ewkt = g.polygon ? polygonToEwkt(g.polygon) : null;
      const appliesTo = pgArray(g.appliesTo);
      return runEdit(
        db,
        sql`
        WITH ${actorIsAdminCte(actorId)},
        geom AS (
          SELECT COALESCE(ST_IsValid(shape), true) AS ok, ST_IsValidReason(shape) AS reason
          FROM (SELECT ST_GeomFromEWKT(${ewkt}::text) AS shape) s
        ),
        old AS (SELECT * FROM geofences WHERE id = ${id}::uuid FOR UPDATE),
        updated AS (
          UPDATE geofences t SET
            name = ${g.name}::text,
            area = COALESCE(${ewkt}::geography, old.area),
            surcharge = ${g.surcharge}::int,
            applies_to = ${appliesTo}::vehicle_type[],
            active = ${g.active}::boolean,
            updated_at = now(),
            updated_by = ${actorId}::uuid
          FROM old, actor_ok, geom
          WHERE t.id = old.id AND actor_ok.ok AND geom.ok
            AND (old.name, old.area::text, old.surcharge, old.applies_to, old.active)
              IS DISTINCT FROM
                (${g.name}::text, COALESCE((${ewkt}::geography)::text, old.area::text), ${g.surcharge}::int,
                 ${appliesTo}::vehicle_type[], ${g.active}::boolean)
          RETURNING t.*
        ),
        audit AS (
          INSERT INTO fare_changes (entity, entity_key, before, after, changed_by)
          SELECT 'GEOFENCE', u.id::text, ${geofenceJson('old')}, ${geofenceJson('u')},
                 ${actorId}::uuid
          FROM updated u CROSS JOIN old
        )
        SELECT (SELECT ok FROM actor_ok) AS "actorIsAdmin",
               EXISTS (SELECT 1 FROM old) AS "exists",
               (SELECT count(*) FROM updated)::int AS "changed",
               (SELECT ok FROM geom) AS "polygonValid",
               (SELECT reason FROM geom) AS "polygonReason"
      `,
      );
    },
  };
}
