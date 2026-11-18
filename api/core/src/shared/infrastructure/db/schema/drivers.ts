import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  documentStatusEnum,
  documentTypeEnum,
  driverAvailabilityEnum,
  driverVerificationStatusEnum,
  vehicleTypeEnum,
} from './enums';
import { users } from './users';

/**
 * Perfil de conductor (§5.1, HU-201). Existe desde que el pasajero solicita ser conductor; el
 * rol DRIVER se otorga en `user_roles` solo al aprobarse (HU-204). Una cuenta, un vehículo.
 */
export const driverProfiles = pgTable(
  'driver_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    vehicleType: vehicleTypeEnum('vehicle_type').notNull(),
    /** Normalizada: mayúsculas sin espacios ni guiones (ABC123 / ABC12D). */
    plate: text('plate').notNull(),
    brand: text('brand').notNull(),
    model: text('model').notNull(),
    color: text('color').notNull(),
    year: smallint('year').notNull(),
    verificationStatus: driverVerificationStatusEnum('verification_status')
      .notNull()
      .default('PENDING'),
    availability: driverAvailabilityEnum('availability').notNull().default('OFFLINE'),
    rejectionReason: text('rejection_reason'),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    /** Billetera prepago en COP (RF-10, E7). Se mueve solo con el libro wallet_transactions. */
    walletBalance: integer('wallet_balance').notNull().default(0),
    /** Promedio como conductor (RF-12, E9). */
    ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }),
    ratingCount: integer('rating_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('driver_profiles_plate_key').on(t.plate),
    index('driver_profiles_status_applied_idx').on(t.verificationStatus, t.appliedAt, t.userId),
    check('driver_profiles_year_check', sql`${t.year} BETWEEN 1980 AND 2100`),
    check('driver_profiles_plate_format', sql`${t.plate} ~ '^[A-Z]{3}[0-9]{2}[0-9A-Z]$'`),
  ],
);

/**
 * Documento vigente por tipo (HU-202). Volver a subir un tipo reemplaza la fila y lo deja en
 * SUBMITTED; el objeto anterior en R2 queda con su clave versionada para auditoría.
 * Los archivos nunca son públicos: se leen con URL firmada de corta duración (solo ADMIN).
 */
export const driverDocuments = pgTable(
  'driver_documents',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => driverProfiles.userId, { onDelete: 'cascade' }),
    type: documentTypeEnum('type').notNull(),
    /** Clave del objeto en R2: drivers/<userId>/<type>/<uuid>. */
    r2Key: text('r2_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    status: documentStatusEnum('status').notNull().default('SUBMITTED'),
    rejectionReason: text('rejection_reason'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.type] }),
    check('driver_documents_size_check', sql`${t.sizeBytes} > 0`),
  ],
);

export type DriverProfileRow = typeof driverProfiles.$inferSelect;
export type NewDriverProfileRow = typeof driverProfiles.$inferInsert;
export type DriverDocumentRow = typeof driverDocuments.$inferSelect;
