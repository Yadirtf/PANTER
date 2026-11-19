import { DocumentStatus, DriverAvailability, DriverVerificationStatus } from '@panter/contracts';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { rowsOf } from '../../../shared/infrastructure/db/rows';
import {
  driverDocuments,
  driverProfiles,
  type DriverDocumentRow,
  type DriverProfileRow,
} from '../../../shared/infrastructure/db/schema';
import type { DriverAvailability as DriverAvailabilityPort } from '../../auth/application/ports';
import type { DriverModeEligibility } from '../../auth/application/ports';
import type { AnyPgDatabase } from '../../auth/infrastructure/drizzle-user-repository';
import type { DriverRepository } from '../application/ports';
import type {
  DocumentContentType,
  DriverDocumentRecord,
  DriverProfileRecord,
  Vehicle,
} from '../domain/driver-profile';
import { allowedFrom, canUseDriverMode, DriverAction } from '../domain/driver-status';
import { isUniqueViolation } from './pg-errors';

export const PLATE_CONSTRAINT = 'driver_profiles_plate_key';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toProfileRecord(row: DriverProfileRow): DriverProfileRecord {
  return {
    userId: row.userId,
    vehicle: {
      vehicleType: row.vehicleType,
      plate: row.plate,
      brand: row.brand,
      model: row.model,
      color: row.color,
      year: row.year,
    },
    verificationStatus: row.verificationStatus,
    availability: row.availability,
    rejectionReason: row.rejectionReason,
    appliedAt: row.appliedAt.toISOString(),
    reviewedAt: iso(row.reviewedAt),
    reviewedBy: row.reviewedBy,
  };
}

export function toDocumentRecord(row: DriverDocumentRow): DriverDocumentRecord {
  return {
    userId: row.userId,
    type: row.type,
    r2Key: row.r2Key,
    contentType: row.contentType as DocumentContentType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    rejectionReason: row.rejectionReason,
    uploadedAt: row.uploadedAt.toISOString(),
    reviewedAt: iso(row.reviewedAt),
    reviewedBy: row.reviewedBy,
  };
}

/** RETURNING de `db.execute`: la fecha ya formateada en UTC (igual con neon-http y postgres-js). */
type RawDocumentRow = Pick<
  DriverDocumentRow,
  'userId' | 'type' | 'r2Key' | 'contentType' | 'sizeBytes' | 'status' | 'rejectionReason'
> & { uploadedAt: string };

const vehicleColumns = (v: Vehicle) => ({
  vehicleType: v.vehicleType,
  plate: v.plate,
  brand: v.brand,
  model: v.model,
  color: v.color,
  year: v.year,
});

export type DriverAccountRepository = DriverRepository &
  DriverAvailabilityPort &
  DriverModeEligibility;

/**
 * Repositorio del solicitante sobre `driver_profiles` y `driver_documents` (migración 0004),
 * y adaptadores de los puertos de auth `DriverAvailability` y `DriverModeEligibility` (HU-104).
 *
 * La placa es única (`driver_profiles_plate_key`): en vez de consultar antes (carrera), se
 * inserta y la violación 23505 de esa restricción se traduce a `plate_taken`.
 */
export function createDrizzleDriverRepository(db: AnyPgDatabase): DriverAccountRepository {
  async function guardPlate<T>(
    run: () => Promise<T>,
  ): Promise<T | { ok: false; reason: 'plate_taken' }> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error, PLATE_CONSTRAINT)) return { ok: false, reason: 'plate_taken' };
      throw error;
    }
  }

  return {
    async findProfile(userId) {
      const [row] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, userId));
      return row ? toProfileRecord(row) : null;
    },

    async listDocuments(userId) {
      const rows = await db
        .select()
        .from(driverDocuments)
        .where(eq(driverDocuments.userId, userId));
      return rows.map(toDocumentRecord);
    },

    create: (userId, vehicle) =>
      guardPlate(async () => {
        const [row] = await db
          .insert(driverProfiles)
          .values({ userId, ...vehicleColumns(vehicle) })
          .onConflictDoNothing({ target: driverProfiles.userId })
          .returning();
        return row
          ? { ok: true as const, profile: toProfileRecord(row) }
          : { ok: false as const, reason: 'exists' as const };
      }),

    resubmit: (userId, vehicle) =>
      guardPlate(async () => {
        const [row] = await db
          .update(driverProfiles)
          .set({
            ...vehicleColumns(vehicle),
            verificationStatus: DriverVerificationStatus.PENDING,
            rejectionReason: null,
            reviewedAt: null,
            reviewedBy: null,
            appliedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(driverProfiles.userId, userId),
              inArray(driverProfiles.verificationStatus, [...allowedFrom(DriverAction.RESUBMIT)]),
            ),
          )
          .returning();
        return row
          ? { ok: true as const, profile: toProfileRecord(row) }
          : { ok: false as const, reason: 'not_rejected' as const };
      }),

    // Una sola sentencia: inserta o reemplaza el documento vigente de ese tipo solo si el
    // perfil está PENDING o REJECTED. Reemplazar deja SUBMITTED y limpia la revisión anterior;
    // el objeto R2 anterior se conserva con su propia clave (auditoría).
    async upsertDocument({ userId, type, r2Key, contentType, sizeBytes }) {
      const result = await db.execute(sql`
        WITH editable AS (
          SELECT user_id FROM driver_profiles
          WHERE user_id = ${userId}::uuid
            AND verification_status IN (${DriverVerificationStatus.PENDING}::driver_verification_status,
                                        ${DriverVerificationStatus.REJECTED}::driver_verification_status)
        )
        INSERT INTO driver_documents (user_id, type, r2_key, content_type, size_bytes, status)
        SELECT user_id, ${type}::document_type, ${r2Key}, ${contentType}, ${sizeBytes},
               ${DocumentStatus.SUBMITTED}::document_status
        FROM editable
        ON CONFLICT (user_id, type) DO UPDATE SET
          r2_key = EXCLUDED.r2_key,
          content_type = EXCLUDED.content_type,
          size_bytes = EXCLUDED.size_bytes,
          status = EXCLUDED.status,
          rejection_reason = NULL,
          uploaded_at = now(),
          reviewed_at = NULL,
          reviewed_by = NULL
        RETURNING user_id AS "userId", type, r2_key AS "r2Key", content_type AS "contentType",
                  size_bytes AS "sizeBytes", status, rejection_reason AS "rejectionReason",
                  to_char(uploaded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                    AS "uploadedAt"
      `);
      const row = rowsOf<RawDocumentRow>(result)[0];
      return row
        ? {
            ...row,
            contentType: row.contentType as DocumentContentType,
            reviewedAt: null,
            reviewedBy: null,
          }
        : null;
    },

    async setUnavailable(userId) {
      await db
        .update(driverProfiles)
        .set({ availability: DriverAvailability.OFFLINE, updatedAt: sql`now()` })
        .where(
          and(
            eq(driverProfiles.userId, userId),
            ne(driverProfiles.availability, DriverAvailability.OFFLINE),
          ),
        );
    },

    async canUseDriverMode(userId) {
      const [row] = await db
        .select({ status: driverProfiles.verificationStatus })
        .from(driverProfiles)
        .where(eq(driverProfiles.userId, userId));
      return canUseDriverMode(row?.status ?? null);
    },
  };
}
