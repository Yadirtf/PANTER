import type { Area, AreaKind, AreaSummary } from '@panter/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { toEwkt } from '../../../shared/infrastructure/db/geography';
import { parsePolygon, polygonToEwkt } from '../../../shared/infrastructure/db/geography-polygon';
import { rowsOf } from '../../../shared/infrastructure/db/rows';
import type { AnyPgDatabase } from '../../auth/infrastructure/drizzle-user-repository';
import type { AreaRepository, AreaWriteResult, ImportCheck } from '../application/ports';
import {
  actorIsAdminCte,
  areaJson,
  isoMillis,
  isUniqueViolation,
  relinkPlacesCte,
} from './drizzle-catalog-sql';

/** Índice único (kind, name_search) de 0006_e15_catalog.sql. */
export const AREA_NAME_CONSTRAINT = 'areas_kind_name_search_key';

interface SummaryRow {
  id: string;
  name: string;
  kind: AreaKind;
  active: boolean;
}

interface AreaRow extends SummaryRow {
  polygon: string;
  source: string | null;
  lat: number | string;
  lng: number | string;
  updatedAt: string;
  updatedBy: string | null;
}

interface WriteRow {
  actorIsAdmin: boolean;
  exists: boolean;
  polygonValid: boolean | null;
  polygonReason: string | null;
  nameTaken: boolean;
  id: string | null;
  changed: number | string;
}

const summary = (r: SummaryRow): AreaSummary => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  active: r.active,
});

function writeResult(row: WriteRow | undefined): AreaWriteResult {
  return {
    actorIsAdmin: row?.actorIsAdmin === true,
    exists: row?.exists === true,
    polygonValid: row?.polygonValid !== false,
    polygonReason: row?.polygonReason ?? null,
    nameTaken: row?.nameTaken === true,
    id: row?.id ?? null,
    changed: Number(row?.changed ?? 0) > 0,
  };
}

/** Un INSERT o UPDATE que choca con otro simultáneo por el nombre → `nameTaken`. */
async function guarded(run: () => Promise<AreaWriteResult>): Promise<AreaWriteResult> {
  try {
    return await run();
  } catch (error) {
    if (!isUniqueViolation(error, AREA_NAME_CONSTRAINT)) throw error;
    return {
      actorIsAdmin: true,
      exists: true,
      polygonValid: true,
      polygonReason: null,
      nameTaken: true,
      id: null,
      changed: false,
    };
  }
}

/** `ST_IsValid` y `ST_IsValidReason` del polígono (NULL = sin polígono nuevo: válido). */
const geomCte = (ewkt: string | null) => sql`
  geom AS (
    SELECT COALESCE(ST_IsValid(shape), true) AS ok, ST_IsValidReason(shape) AS reason
    FROM (SELECT ST_GeomFromEWKT(${ewkt}::text) AS shape) s
  )`;

/**
 * Repositorio de `areas` (HU-308) sobre PostGIS.
 * - Lecturas: sin polígono en la lista; detalle con GeoJSON y centro (`ST_PointOnSurface`, que
 *   siempre cae dentro del polígono, a diferencia del centroide); `locate` con `ST_Covers` y el
 *   índice GIST, el de menor área si se solapan.
 * - Escrituras: una sola sentencia que comprueba al actor, valida el polígono (`ST_IsValid`),
 *   comprueba el nombre, escribe, registra en `catalog_changes` y recalcula `places.area_id`.
 */
export function createDrizzleAreaRepository(db: AnyPgDatabase): AreaRepository {
  async function select(where: SQL): Promise<Area[]> {
    const rows = rowsOf<AreaRow>(
      await db.execute(sql`
        SELECT a.id, a.name, a.kind, a.active, a.source,
               ST_AsGeoJSON(a.polygon) AS polygon,
               ST_Y(c.pt) AS lat, ST_X(c.pt) AS lng,
               ${isoMillis('a.updated_at')} AS "updatedAt",
               u.email AS "updatedBy"
        FROM areas a
        LEFT JOIN users u ON u.id = a.updated_by
        CROSS JOIN LATERAL (SELECT ST_PointOnSurface(a.polygon::geometry) AS pt) c
        WHERE ${where}
      `),
    );
    return rows.map((r) => ({
      ...summary(r),
      polygon: parsePolygon(r.polygon),
      source: r.source,
      center: { lat: Number(r.lat), lng: Number(r.lng) },
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy,
    }));
  }

  return {
    async list({ search, kind, includeInactive }) {
      const rows = await db.execute(sql`
        SELECT id, name, kind, active FROM areas
        WHERE (active OR ${includeInactive}::boolean)
          AND (${kind ?? null}::area_kind IS NULL OR kind = ${kind ?? null}::area_kind)
          AND name_search LIKE ${`%${search ?? ''}%`}
        ORDER BY kind, name
      `);
      return rowsOf<SummaryRow>(rows).map(summary);
    },

    get: async (id) => (await select(sql`a.id = ${id}::uuid`))[0] ?? null,

    getMany: (ids) =>
      ids.length === 0
        ? Promise.resolve([])
        : select(sql`a.id = ANY(${`{${ids.join(',')}}`}::uuid[])`),

    async locate(point) {
      const rows = await db.execute(sql`
        SELECT id, name, kind, active FROM areas
        WHERE active AND ST_Covers(polygon, ${toEwkt(point)}::geography)
        ORDER BY ST_Area(polygon), id
        LIMIT 1
      `);
      const r = rowsOf<SummaryRow>(rows)[0];
      return r ? summary(r) : null;
    },

    create: ({ actorId, area }) => {
      const ewkt = polygonToEwkt(area.polygon);
      return guarded(async () => {
        const rows = await db.execute(sql`
          WITH ${actorIsAdminCte(actorId)},
          ${geomCte(ewkt)},
          taken AS (
            SELECT EXISTS (
              SELECT 1 FROM areas WHERE kind = ${area.kind}::area_kind AND name_search = ${area.nameSearch}
            ) AS yes
          ),
          inserted AS (
            INSERT INTO areas (name, name_search, kind, polygon, source, updated_by)
            SELECT ${area.name}::text, ${area.nameSearch}::text, ${area.kind}::area_kind,
                   ${ewkt}::geography, ${area.source}::text, ${actorId}::uuid
            FROM actor_ok, geom, taken
            WHERE actor_ok.ok AND geom.ok AND NOT taken.yes
            ON CONFLICT (kind, name_search) DO NOTHING
            RETURNING *
          ),
          audit AS (
            INSERT INTO catalog_changes (entity, entity_id, action, before, after, changed_by)
            SELECT 'AREA', i.id, 'CREATE', NULL, ${areaJson('i')}, ${actorId}::uuid
            FROM inserted i
          ),
          changed AS (SELECT id, polygon, active FROM inserted),
          ${relinkPlacesCte('changed')}
          SELECT (SELECT ok FROM actor_ok) AS "actorIsAdmin",
                 true AS "exists",
                 (SELECT ok FROM geom) AS "polygonValid",
                 (SELECT reason FROM geom) AS "polygonReason",
                 (SELECT ok FROM actor_ok) AND (SELECT ok FROM geom)
                   AND NOT EXISTS (SELECT 1 FROM inserted) AS "nameTaken",
                 (SELECT id FROM inserted) AS id,
                 (SELECT count(*) FROM inserted)::int AS changed,
                 (SELECT count(*) FROM relink)::int AS relinked
        `);
        return writeResult(rowsOf<WriteRow>(rows)[0]);
      });
    },

    update: ({ id, actorId, patch }) => {
      const ewkt = patch.polygon ? polygonToEwkt(patch.polygon) : null;
      const sourceSet = patch.source !== undefined;
      return guarded(async () => {
        const rows = await db.execute(sql`
          WITH ${actorIsAdminCte(actorId)},
          ${geomCte(ewkt)},
          old AS (SELECT * FROM areas WHERE id = ${id}::uuid FOR UPDATE),
          next AS (
            SELECT COALESCE(${patch.name ?? null}::text, old.name) AS name,
                   COALESCE(${patch.nameSearch ?? null}::text, old.name_search) AS name_search,
                   COALESCE(${patch.kind ?? null}::area_kind, old.kind) AS kind,
                   COALESCE(${ewkt}::geography, old.polygon) AS polygon,
                   CASE WHEN ${sourceSet}::boolean THEN ${patch.source ?? null}::text ELSE old.source END AS source,
                   COALESCE(${patch.active ?? null}::boolean, old.active) AS active
            FROM old
          ),
          taken AS (
            SELECT EXISTS (
              SELECT 1 FROM areas a, next n
              WHERE a.kind = n.kind AND a.name_search = n.name_search AND a.id <> ${id}::uuid
            ) AS yes
          ),
          updated AS (
            UPDATE areas t SET
              name = n.name, name_search = n.name_search, kind = n.kind, polygon = n.polygon,
              source = n.source, active = n.active, updated_at = now(), updated_by = ${actorId}::uuid
            FROM old, next n, actor_ok, geom, taken
            WHERE t.id = old.id AND actor_ok.ok AND geom.ok AND NOT taken.yes
              AND (old.name, old.kind, old.polygon::text, old.source, old.active)
                IS DISTINCT FROM (n.name, n.kind, n.polygon::text, n.source, n.active)
            RETURNING t.*
          ),
          audit AS (
            INSERT INTO catalog_changes (entity, entity_id, action, before, after, changed_by)
            SELECT 'AREA', u.id, 'UPDATE', ${areaJson('old')}, ${areaJson('u')}, ${actorId}::uuid
            FROM updated u CROSS JOIN old
          ),
          changed AS (
            SELECT u.id, u.polygon, u.active FROM updated u CROSS JOIN old
            WHERE (u.polygon::text, u.active) IS DISTINCT FROM (old.polygon::text, old.active)
          ),
          ${relinkPlacesCte('changed')}
          SELECT (SELECT ok FROM actor_ok) AS "actorIsAdmin",
                 EXISTS (SELECT 1 FROM old) AS "exists",
                 (SELECT ok FROM geom) AS "polygonValid",
                 (SELECT reason FROM geom) AS "polygonReason",
                 (SELECT yes FROM taken) AS "nameTaken",
                 ${id}::uuid AS id,
                 (SELECT count(*) FROM updated)::int AS changed,
                 (SELECT count(*) FROM relink)::int AS relinked
        `);
        return writeResult(rowsOf<WriteRow>(rows)[0]);
      });
    },

    async checkImport(items) {
      const input = JSON.stringify(
        items.map((i) => ({
          idx: i.index,
          kind: i.kind,
          key: i.nameSearch,
          ewkt: polygonToEwkt(i.polygon),
        })),
      );
      const rows = await db.execute(sql`
        SELECT x.idx AS "index",
               COALESCE(ST_IsValid(g.shape), false) AS valid,
               ST_IsValidReason(g.shape) AS reason,
               EXISTS (
                 SELECT 1 FROM areas a WHERE a.kind = x.kind::area_kind AND a.name_search = x.key
               ) AS "replacesExisting"
        FROM jsonb_to_recordset(${input}::jsonb) AS x(idx int, kind text, key text, ewkt text)
        CROSS JOIN LATERAL (SELECT ST_GeomFromEWKT(x.ewkt) AS shape) g
        ORDER BY x.idx
      `);
      return rowsOf<ImportCheck>(rows).map((r) => ({
        index: Number(r.index),
        valid: r.valid === true,
        reason: r.reason ?? null,
        replacesExisting: r.replacesExisting === true,
      }));
    },

    async importAreas({ actorId, source, items }) {
      const input = JSON.stringify(
        items.map((i) => ({
          name: i.name,
          key: i.nameSearch,
          kind: i.kind,
          ewkt: polygonToEwkt(i.polygon),
        })),
      );
      const rows = await db.execute(sql`
        WITH ${actorIsAdminCte(actorId)},
        x AS (
          SELECT * FROM jsonb_to_recordset(${input}::jsonb)
            AS x(name text, key text, kind area_kind, ewkt text)
        ),
        -- Sin FOR UPDATE: "old" solo lo lee el historial, después del upsert, y una fila
        -- bloqueada que la misma sentencia modificó se omitiría. El upsert ya bloquea las filas.
        old AS (
          SELECT a.* FROM areas a JOIN x ON a.kind = x.kind AND a.name_search = x.key
        ),
        up AS (
          INSERT INTO areas AS t (name, name_search, kind, polygon, source, updated_by)
          SELECT x.name, x.key, x.kind, x.ewkt::geography, ${source}::text, ${actorId}::uuid
          FROM x, actor_ok WHERE actor_ok.ok
          ON CONFLICT (kind, name_search) DO UPDATE SET
            name = EXCLUDED.name,
            polygon = EXCLUDED.polygon,
            source = COALESCE(EXCLUDED.source, t.source),
            updated_at = now(),
            updated_by = EXCLUDED.updated_by
          RETURNING t.*
        ),
        audit AS (
          INSERT INTO catalog_changes (entity, entity_id, action, before, after, changed_by)
          SELECT 'AREA', u.id, 'IMPORT',
                 CASE WHEN o.id IS NULL THEN NULL ELSE ${areaJson('o')} END,
                 ${areaJson('u')}, ${actorId}::uuid
          FROM up u LEFT JOIN old o ON o.id = u.id
        ),
        changed AS (SELECT id, polygon, active FROM up),
        ${relinkPlacesCte('changed')}
        SELECT (SELECT ok FROM actor_ok) AS "actorIsAdmin",
               (SELECT count(*) FROM up)::int AS saved,
               (SELECT count(*) FROM relink)::int AS relinked
      `);
      const row = rowsOf<{ actorIsAdmin: boolean; saved: number | string }>(rows)[0];
      return { actorIsAdmin: row?.actorIsAdmin === true, saved: Number(row?.saved ?? 0) };
    },
  };
}
