import type { FareRule } from '@panter/contracts';
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { fareRules, users } from '../../../shared/infrastructure/db/schema';
import type { AnyPgDatabase } from '../../auth/infrastructure/drizzle-user-repository';
import type { FareRuleRepository } from '../application/ports';
import { actorIsAdminCte, runEdit } from './drizzle-fare-sql';

/** Snapshot JSON de una regla para `fare_changes` (mismos nombres que la API). */
const ruleJson = (t: string) =>
  sql.raw(`jsonb_build_object(
    'pricingModel', ${t}.pricing_model, 'baseFare', ${t}.base_fare, 'perKm', ${t}.per_km,
    'perMinute', ${t}.per_minute, 'minimumFare', ${t}.minimum_fare,
    'nightSurcharge', ${t}.night_surcharge, 'nightStartMinute', ${t}.night_start_minute,
    'nightEndMinute', ${t}.night_end_minute, 'roundTo', ${t}.round_to, 'active', ${t}.active)`);

/**
 * Repositorio de `fare_rules` (HU-401). La edición es **una sola sentencia** (neon-http no
 * tiene transacciones interactivas, y una sentencia es atómica):
 * 1. comprueba que el actor sigue siendo ADMIN activo;
 * 2. bloquea la regla con `FOR UPDATE` y guarda cómo estaba;
 * 3. actualiza solo si algo cambió y escribe antes/después/autor en `fare_changes`.
 */
export function createDrizzleFareRuleRepository(db: AnyPgDatabase): FareRuleRepository {
  async function select(where?: SQL): Promise<FareRule[]> {
    const rows = await db
      .select({ rule: fareRules, updatedByEmail: users.email })
      .from(fareRules)
      .leftJoin(users, eq(users.id, fareRules.updatedBy))
      .where(where)
      .orderBy(asc(fareRules.vehicleType));
    return rows.map(({ rule, updatedByEmail }) => ({
      vehicleType: rule.vehicleType,
      pricingModel: rule.pricingModel,
      baseFare: rule.baseFare,
      perKm: rule.perKm,
      perMinute: rule.perMinute,
      minimumFare: rule.minimumFare,
      nightSurcharge: rule.nightSurcharge,
      nightStartMinute: rule.nightStartMinute,
      nightEndMinute: rule.nightEndMinute,
      roundTo: rule.roundTo,
      active: rule.active,
      updatedAt: rule.updatedAt.toISOString(),
      updatedBy: updatedByEmail,
    }));
  }

  return {
    list: () => select(),
    get: async (vehicleType) => (await select(eq(fareRules.vehicleType, vehicleType)))[0] ?? null,
    update: ({ vehicleType, actorId, rule: r }) =>
      runEdit(
        db,
        sql`
        WITH ${actorIsAdminCte(actorId)},
        old AS (
          SELECT * FROM fare_rules WHERE vehicle_type = ${vehicleType}::vehicle_type FOR UPDATE
        ),
        updated AS (
          UPDATE fare_rules f SET
            pricing_model = ${r.pricingModel}::pricing_model,
            base_fare = ${r.baseFare}::int,
            per_km = ${r.perKm}::int,
            per_minute = ${r.perMinute}::int,
            minimum_fare = ${r.minimumFare}::int,
            night_surcharge = ${r.nightSurcharge}::int,
            night_start_minute = ${r.nightStartMinute}::smallint,
            night_end_minute = ${r.nightEndMinute}::smallint,
            round_to = ${r.roundTo}::int,
            active = ${r.active}::boolean,
            updated_at = now(),
            updated_by = ${actorId}::uuid
          FROM old, actor_ok
          WHERE f.vehicle_type = old.vehicle_type AND actor_ok.ok
            AND (old.pricing_model, old.base_fare, old.per_km, old.per_minute, old.minimum_fare,
                 old.night_surcharge, old.night_start_minute, old.night_end_minute, old.round_to,
                 old.active)
              IS DISTINCT FROM
                (${r.pricingModel}::pricing_model, ${r.baseFare}::int, ${r.perKm}::int,
                 ${r.perMinute}::int, ${r.minimumFare}::int, ${r.nightSurcharge}::int,
                 ${r.nightStartMinute}::smallint, ${r.nightEndMinute}::smallint,
                 ${r.roundTo}::int, ${r.active}::boolean)
          RETURNING f.*
        ),
        audit AS (
          INSERT INTO fare_changes (entity, entity_key, before, after, changed_by)
          SELECT 'FARE_RULE', u.vehicle_type::text, ${ruleJson('old')}, ${ruleJson('u')},
                 ${actorId}::uuid
          FROM updated u CROSS JOIN old
        )
        SELECT (SELECT ok FROM actor_ok) AS "actorIsAdmin",
               EXISTS (SELECT 1 FROM old) AS "exists",
               (SELECT count(*) FROM updated)::int AS "changed"
      `,
      ),
  };
}
