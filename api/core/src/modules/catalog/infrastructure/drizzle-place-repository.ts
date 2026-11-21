import type { AreaKind, LatLng, Place, PlaceCategory } from '@panter/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { toEwkt } from '../../../shared/infrastructure/db/geography';
import { rowsOf } from '../../../shared/infrastructure/db/rows';
import type { AnyPgDatabase } from '../../auth/infrastructure/drizzle-user-repository';
import type { PlaceRepository, PlaceWriteResult } from '../application/ports';
import { actorIsAdminCte, isoMillisText, isUniqueViolation } from './drizzle-catalog-sql';

/** Índice único del slug de 0006_e15_catalog.sql. */
export const PLACE_SLUG_CONSTRAINT = 'places_slug_key';

interface PlaceRow {
  id: string;
  slug: string;
  name: string;
  category: PlaceCategory;
  lat: number | string;
  lng: number | string;
  pickupLat: number | string | null;
  pickupLng: number | string | null;
  verified: boolean;
  active: boolean;
  source: string | null;
  updatedAt: string;
  areaId: string | null;
  areaName: string | null;
  areaKind: AreaKind | null;
  areaActive: boolean | null;
  distanceMeters?: number | string;
}

interface WriteRow {
  actorIsAdmin: boolean;
  exists: boolean;
  slugTaken: boolean;
  id: string | null;
  changed: number | string;
}

function toPlace(r: PlaceRow): Place {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    category: r.category,
    location: { lat: Number(r.lat), lng: Number(r.lng) },
    pickupPoint:
      r.pickupLat === null || r.pickupLng === null
        ? null
        : { lat: Number(r.pickupLat), lng: Number(r.pickupLng) },
    area:
      r.areaId && r.areaName && r.areaKind
        ? { id: r.areaId, name: r.areaName, kind: r.areaKind, active: r.areaActive === true }
        : null,
    verified: r.verified,
    active: r.active,
    source: r.source,
    updatedAt: r.updatedAt,
  };
}

function writeResult(row: WriteRow | undefined): PlaceWriteResult {
  return {
    actorIsAdmin: row?.actorIsAdmin === true,
    exists: row?.exists === true,
    slugTaken: row?.slugTaken === true,
    id: row?.id ?? null,
    changed: Number(row?.changed ?? 0) > 0,
  };
}

/** Columnas de un lugar con su barrio o vereda (alias `p` y `a`). */
const COLUMNS = sql.raw(`
  p.id, p.slug, p.name, p.category,
  ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng,
  ST_Y(p.pickup_point::geometry) AS "pickupLat", ST_X(p.pickup_point::geometry) AS "pickupLng",
  p.verified, p.active, p.source,
  ${isoMillisText('p.updated_at')} AS "updatedAt",
  a.id AS "areaId", a.name AS "areaName", a.kind AS "areaKind", a.active AS "areaActive"`);

/** Barrio o vereda activo de menor área que cubre el punto (igual que GET /areas/locate). */
const areaOf = (point: SQL) => sql`(
  SELECT a.id FROM areas a
  WHERE a.active AND ST_Covers(a.polygon, ${point})
  ORDER BY ST_Area(a.polygon), a.id
  LIMIT 1
)`;

/** Snapshot JSON de un lugar para `catalog_changes`; los puntos van como GeoJSON. */
const placeJson = (t: string) =>
  sql.raw(`jsonb_build_object(
    'slug', ${t}.slug, 'name', ${t}.name, 'category', ${t}.category,
    'location', ST_AsGeoJSON(${t}.location)::jsonb,
    'pickupPoint', ST_AsGeoJSON(${t}.pickup_point)::jsonb,
    'areaId', ${t}.area_id, 'verified', ${t}.verified, 'active', ${t}.active,
    'source', ${t}.source)`);

const point = (p: LatLng | null | undefined) => (p ? toEwkt(p) : null);

async function guarded(run: () => Promise<PlaceWriteResult>): Promise<PlaceWriteResult> {
  try {
    return await run();
  } catch (error) {
    if (!isUniqueViolation(error, PLACE_SLUG_CONSTRAINT)) throw error;
    return { actorIsAdmin: true, exists: true, slugTaken: true, id: null, changed: false };
  }
}

/**
 * Repositorio de `places` (HU-310) sobre PostGIS. `area_id` se calcula al guardar con
 * `ST_Covers` sobre `areas` (y lo recalculan las ediciones de barrios), así las lecturas solo
 * hacen un join. `nearby` usa `ST_DWithin` con el índice GIST `places_location_gist`.
 */
export function createDrizzlePlaceRepository(db: AnyPgDatabase): PlaceRepository {
  async function select(where: SQL, limit: number): Promise<Place[]> {
    const rows = await db.execute(sql`
      SELECT ${COLUMNS} FROM places p LEFT JOIN areas a ON a.id = p.area_id
      WHERE ${where}
      ORDER BY p.name, p.id
      LIMIT ${limit}
    `);
    return rowsOf<PlaceRow>(rows).map(toPlace);
  }

  return {
    list: ({ search, category, includeInactive, limit }) =>
      select(
        sql`(p.active OR ${includeInactive}::boolean)
          AND (${category ?? null}::place_category IS NULL OR p.category = ${category ?? null}::place_category)
          AND p.name_search ILIKE ${`%${search ?? ''}%`}`,
        limit,
      ),

    async nearby({ point: center, radiusMeters, limit }) {
      const pt = toEwkt(center);
      const rows = await db.execute(sql`
        SELECT ${COLUMNS}, ST_Distance(p.location, ${pt}::geography) AS "distanceMeters"
        FROM places p LEFT JOIN areas a ON a.id = p.area_id
        WHERE p.active AND ST_DWithin(p.location, ${pt}::geography, ${radiusMeters})
        ORDER BY "distanceMeters", p.id
        LIMIT ${limit}
      `);
      return rowsOf<PlaceRow>(rows).map((r) => ({
        ...toPlace(r),
        distanceMeters: Math.round(Number(r.distanceMeters)),
      }));
    },

    get: async (id) => (await select(sql`p.id = ${id}::uuid`, 1))[0] ?? null,

    create: ({ actorId, place }) =>
      guarded(async () => {
        const loc = toEwkt(place.location);
        const rows = await db.execute(sql`
          WITH ${actorIsAdminCte(actorId)},
          taken AS (SELECT EXISTS (SELECT 1 FROM places WHERE slug = ${place.slug}) AS yes),
          inserted AS (
            INSERT INTO places (slug, name, name_search, category, location, pickup_point,
                                area_id, verified, source, updated_by)
            SELECT ${place.slug}::text, ${place.name}::text, ${place.nameSearch}::text,
                   ${place.category}::place_category, ${loc}::geography,
                   ${point(place.pickupPoint)}::geography,
                   ${areaOf(sql`${loc}::geography`)},
                   ${place.verified}::boolean, ${place.source}::text, ${actorId}::uuid
            FROM actor_ok, taken WHERE actor_ok.ok AND NOT taken.yes
            ON CONFLICT (slug) DO NOTHING
            RETURNING *
          ),
          audit AS (
            INSERT INTO catalog_changes (entity, entity_id, action, before, after, changed_by)
            SELECT 'PLACE', i.id, 'CREATE', NULL, ${placeJson('i')}, ${actorId}::uuid
            FROM inserted i
          )
          SELECT (SELECT ok FROM actor_ok) AS "actorIsAdmin",
                 true AS "exists",
                 (SELECT ok FROM actor_ok) AND NOT EXISTS (SELECT 1 FROM inserted) AS "slugTaken",
                 (SELECT id FROM inserted) AS id,
                 (SELECT count(*) FROM inserted)::int AS changed
        `);
        return writeResult(rowsOf<WriteRow>(rows)[0]);
      }),

    async update({ id, actorId, patch }) {
      const loc = point(patch.location);
      const pickupSet = patch.pickupPoint !== undefined;
      const sourceSet = patch.source !== undefined;
      const rows = await db.execute(sql`
        WITH ${actorIsAdminCte(actorId)},
        old AS (SELECT * FROM places WHERE id = ${id}::uuid FOR UPDATE),
        next AS (
          SELECT COALESCE(${patch.name ?? null}::text, old.name) AS name,
                 COALESCE(${patch.nameSearch ?? null}::text, old.name_search) AS name_search,
                 COALESCE(${patch.category ?? null}::place_category, old.category) AS category,
                 COALESCE(${loc}::geography, old.location) AS location,
                 CASE WHEN ${pickupSet}::boolean THEN ${point(patch.pickupPoint)}::geography
                      ELSE old.pickup_point END AS pickup_point,
                 COALESCE(${patch.verified ?? null}::boolean, old.verified) AS verified,
                 CASE WHEN ${sourceSet}::boolean THEN ${patch.source ?? null}::text
                      ELSE old.source END AS source,
                 COALESCE(${patch.active ?? null}::boolean, old.active) AS active
          FROM old
        ),
        updated AS (
          UPDATE places t SET
            name = n.name, name_search = n.name_search, category = n.category,
            location = n.location, pickup_point = n.pickup_point,
            area_id = ${areaOf(sql`n.location`)},
            verified = n.verified, source = n.source, active = n.active,
            updated_at = now(), updated_by = ${actorId}::uuid
          FROM old, next n, actor_ok
          WHERE t.id = old.id AND actor_ok.ok
            AND (old.name, old.category, old.location::text, old.pickup_point::text,
                 old.verified, old.source, old.active)
              IS DISTINCT FROM
                (n.name, n.category, n.location::text, n.pickup_point::text,
                 n.verified, n.source, n.active)
          RETURNING t.*
        ),
        audit AS (
          INSERT INTO catalog_changes (entity, entity_id, action, before, after, changed_by)
          SELECT 'PLACE', u.id, 'UPDATE', ${placeJson('old')}, ${placeJson('u')}, ${actorId}::uuid
          FROM updated u CROSS JOIN old
        )
        SELECT (SELECT ok FROM actor_ok) AS "actorIsAdmin",
               EXISTS (SELECT 1 FROM old) AS "exists",
               false AS "slugTaken",
               ${id}::uuid AS id,
               (SELECT count(*) FROM updated)::int AS changed
      `);
      return writeResult(rowsOf<WriteRow>(rows)[0]);
    },
  };
}
