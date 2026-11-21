import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { geographyPoint } from '../geography';
import { geographyPolygon } from '../geography-polygon';
import { areaKindEnum, placeCategoryEnum } from './enums';
import { users } from './users';

/**
 * Barrios y veredas (HU-308). `name_search` es el nombre sin tildes ni mayúsculas
 * (`searchKey` de contracts): búsqueda y unicidad sin depender de la extensión unaccent.
 */
export const areas = pgTable(
  'areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    nameSearch: text('name_search').notNull(),
    kind: areaKindEnum('kind').notNull(),
    polygon: geographyPolygon('polygon').notNull(),
    active: boolean('active').notNull().default(true),
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('areas_polygon_gist').using('gist', t.polygon),
    uniqueIndex('areas_kind_name_search_key').on(t.kind, t.nameSearch),
    check('areas_name_check', sql`char_length(${t.name}) BETWEEN 2 AND 80`),
  ],
);

/**
 * Lugares de interés (HU-310). `area_id` se recalcula al guardar con `ST_Covers` sobre `areas`,
 * así las lecturas no hacen consultas espaciales extra. `verified` = ubicación confirmada en sitio.
 */
export const places = pgTable(
  'places',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    nameSearch: text('name_search').notNull(),
    category: placeCategoryEnum('category').notNull(),
    location: geographyPoint('location').notNull(),
    pickupPoint: geographyPoint('pickup_point'),
    areaId: uuid('area_id').references(() => areas.id, { onDelete: 'set null' }),
    verified: boolean('verified').notNull().default(false),
    active: boolean('active').notNull().default(true),
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('places_slug_key').on(t.slug),
    index('places_location_gist').using('gist', t.location),
    index('places_name_search_idx').on(t.nameSearch),
    check('places_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('places_name_check', sql`char_length(${t.name}) BETWEEN 2 AND 80`),
  ],
);

export const catalogEntityEnum = pgEnum('catalog_entity', ['AREA', 'PLACE']);
export const catalogActionEnum = pgEnum('catalog_action', ['CREATE', 'UPDATE', 'IMPORT']);

/** Historial inmutable de cambios de barrios, veredas y lugares (autor, antes y después). */
export const catalogChanges = pgTable(
  'catalog_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entity: catalogEntityEnum('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: catalogActionEnum('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('catalog_changes_entity_idx').on(t.entity, t.entityId, t.changedAt, t.id)],
);

export type AreaRow = typeof areas.$inferSelect;
export type PlaceRow = typeof places.$inferSelect;
export type CatalogChangeRow = typeof catalogChanges.$inferSelect;
