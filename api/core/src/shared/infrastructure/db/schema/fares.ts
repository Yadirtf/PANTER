import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { geographyPolygon } from '../geography-polygon';
import { geofenceKindEnum, pricingModelEnum, vehicleTypeEnum } from './enums';
import { users } from './users';

/** Regla de tarifa por tipo de vehículo (RF-05, HU-401). Valores en COP enteros. */
export const fareRules = pgTable(
  'fare_rules',
  {
    vehicleType: vehicleTypeEnum('vehicle_type').primaryKey(),
    pricingModel: pricingModelEnum('pricing_model').notNull(),
    baseFare: integer('base_fare').notNull(),
    perKm: integer('per_km').notNull().default(0),
    perMinute: integer('per_minute').notNull().default(0),
    minimumFare: integer('minimum_fare').notNull().default(0),
    nightSurcharge: integer('night_surcharge').notNull().default(0),
    /** Minutos desde la medianoche en hora de Colombia (1200 = 8:00 p. m.). */
    nightStartMinute: smallint('night_start_minute').notNull().default(1200),
    nightEndMinute: smallint('night_end_minute').notNull().default(300),
    roundTo: integer('round_to').notNull().default(100),
    active: boolean('active').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    check(
      'fare_rules_amounts_check',
      sql`${t.baseFare} >= 0 AND ${t.perKm} >= 0 AND ${t.perMinute} >= 0 AND ${t.minimumFare} >= 0 AND ${t.nightSurcharge} >= 0`,
    ),
    check(
      'fare_rules_night_check',
      sql`${t.nightStartMinute} BETWEEN 0 AND 1439 AND ${t.nightEndMinute} BETWEEN 0 AND 1439`,
    ),
    check('fare_rules_round_check', sql`${t.roundTo} BETWEEN 1 AND 1000`),
  ],
);

/** Geocercas con recargo (aeropuerto, zona periférica). Índice GIST para `ST_Covers`. */
export const geofences = pgTable(
  'geofences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    kind: geofenceKindEnum('kind').notNull(),
    area: geographyPolygon('area').notNull(),
    surcharge: integer('surcharge').notNull().default(0),
    appliesTo: vehicleTypeEnum('applies_to').array().notNull(),
    active: boolean('active').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('geofences_area_gist').using('gist', t.area),
    check('geofences_surcharge_check', sql`${t.surcharge} >= 0`),
    check('geofences_applies_to_check', sql`cardinality(${t.appliesTo}) > 0`),
  ],
);

export const fareChangeEntityEnum = pgEnum('fare_change_entity', ['FARE_RULE', 'GEOFENCE']);

/** Historial inmutable de cambios de tarifas y geocercas (HU-403): autor, fecha, antes/después. */
export const fareChanges = pgTable(
  'fare_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entity: fareChangeEntityEnum('entity').notNull(),
    /** vehicle_type de la regla o id de la geocerca. */
    entityKey: text('entity_key').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('fare_changes_changed_at_idx').on(t.changedAt, t.id)],
);

export type FareRuleRow = typeof fareRules.$inferSelect;
export type GeofenceRow = typeof geofences.$inferSelect;
export type FareChangeRow = typeof fareChanges.$inferSelect;
