import { z } from 'zod';
import { VehicleType, VehicleTypeSchema } from './enums';

/**
 * Onboarding de conductores (E2: HU-201 a HU-205, RF-02). Un pasajero solicita ser conductor,
 * sube sus documentos a R2 y un ADMIN los revisa. El rol DRIVER solo se otorga al aprobar.
 */

export const DriverVerificationStatus = {
  /** Solicitud creada; faltan documentos o su revisión. */
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  /** Rechazada con motivo; puede corregir documentos y volver a enviar. */
  REJECTED: 'REJECTED',
  /** Aprobada y luego suspendida por un ADMIN: conserva la cuenta como pasajero. */
  SUSPENDED: 'SUSPENDED',
} as const;
export type DriverVerificationStatus =
  (typeof DriverVerificationStatus)[keyof typeof DriverVerificationStatus];
export const DriverVerificationStatusSchema = z.enum(DriverVerificationStatus);

export const DriverAvailability = {
  OFFLINE: 'OFFLINE',
  AVAILABLE: 'AVAILABLE',
  ON_TRIP: 'ON_TRIP',
} as const;
export type DriverAvailability = (typeof DriverAvailability)[keyof typeof DriverAvailability];
export const DriverAvailabilitySchema = z.enum(DriverAvailability);

/** Documentos exigidos (RF-02). */
export const DocumentType = {
  CEDULA: 'CEDULA',
  LICENCIA: 'LICENCIA',
  TARJETA_PROPIEDAD: 'TARJETA_PROPIEDAD',
  SOAT: 'SOAT',
  TECNOMECANICA: 'TECNOMECANICA',
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];
export const DocumentTypeSchema = z.enum(DocumentType);
export const REQUIRED_DOCUMENTS: readonly DocumentType[] = Object.values(DocumentType);

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  CEDULA: 'Cédula de ciudadanía',
  LICENCIA: 'Licencia de conducción',
  TARJETA_PROPIEDAD: 'Tarjeta de propiedad del vehículo',
  SOAT: 'SOAT vigente',
  TECNOMECANICA: 'Revisión técnico-mecánica vigente',
};

export const DocumentStatus = {
  /** Subido, esperando revisión. */
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];
export const DocumentStatusSchema = z.enum(DocumentStatus);

/** Límites de carga: fotos tomadas con la cámara del teléfono. */
export const DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
export const DOCUMENT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const DocumentContentTypeSchema = z.enum(DOCUMENT_CONTENT_TYPES);
/** Vigencia de una URL firmada de subida o de lectura. */
export const DOCUMENT_URL_TTL_SECONDS = 10 * 60;

/**
 * Placa colombiana normalizada (mayúsculas, sin espacios ni guiones):
 * - carros y camperos: 3 letras + 3 números (ABC123);
 * - motos y mototaxis: 3 letras + 2 números + 1 letra (ABC12D).
 */
export const CAR_PLATE_REGEX = /^[A-Z]{3}\d{3}$/;
export const MOTO_PLATE_REGEX = /^[A-Z]{3}\d{2}[A-Z]$/;

export function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

export function isValidPlateFor(vehicleType: VehicleType, plate: string): boolean {
  return vehicleType === VehicleType.MOTOTAXI
    ? MOTO_PLATE_REGEX.test(plate)
    : CAR_PLATE_REGEX.test(plate);
}

/** Año del modelo más antiguo aceptado. */
export const MIN_VEHICLE_YEAR = 1980;

/**
 * Año del modelo más reciente aceptado: el año siguiente al actual (los concesionarios venden
 * modelos del año próximo). Se calcula al validar, nunca al cargar el módulo: en Cloudflare
 * Workers el reloj vale 1970 durante la carga del script, así que `new Date()` en el ámbito
 * global dejaba el máximo en 1971 y rechazaba cualquier vehículo real (VALIDATION_ERROR).
 */
export function maxVehicleYear(now: Date = new Date()): number {
  return now.getUTCFullYear() + 1;
}

export const VehicleSchema = z.object({
  vehicleType: VehicleTypeSchema,
  plate: z.string(),
  brand: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(40),
  color: z.string().trim().min(1).max(30),
  year: z
    .number()
    .int()
    .min(MIN_VEHICLE_YEAR)
    .refine((year) => year <= maxVehicleYear(), {
      error: () => `El año del modelo no puede ser mayor que ${maxVehicleYear()}`,
    }),
});

// POST /drivers/apply
export const DriverApplyBodySchema = VehicleSchema.extend({
  plate: z.string().transform(normalizePlate),
}).superRefine((v, ctx) => {
  if (!isValidPlateFor(v.vehicleType, v.plate)) {
    ctx.addIssue({
      code: 'custom',
      path: ['plate'],
      message:
        v.vehicleType === VehicleType.MOTOTAXI
          ? 'Placa de moto inválida (ej.: ABC12D)'
          : 'Placa inválida (ej.: ABC123)',
    });
  }
});
export type DriverApplyBody = z.infer<typeof DriverApplyBodySchema>;

export const DriverDocumentSchema = z.object({
  type: DocumentTypeSchema,
  status: DocumentStatusSchema,
  contentType: DocumentContentTypeSchema,
  sizeBytes: z.number().int().positive(),
  uploadedAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(),
  rejectionReason: z.string().nullable(),
});
export type DriverDocument = z.infer<typeof DriverDocumentSchema>;

/** Perfil de conductor propio: GET /drivers/me y respuesta de POST /drivers/apply. */
export const DriverProfileSchema = z.object({
  userId: z.uuid(),
  vehicle: VehicleSchema,
  verificationStatus: DriverVerificationStatusSchema,
  availability: DriverAvailabilitySchema,
  rejectionReason: z.string().nullable(),
  appliedAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(),
  /** Un elemento por documento subido; los que faltan no aparecen. */
  documents: z.array(DriverDocumentSchema),
  /** Documentos exigidos que aún no se han subido o fueron rechazados. */
  missingDocuments: z.array(DocumentTypeSchema),
});
export type DriverProfile = z.infer<typeof DriverProfileSchema>;

// POST /drivers/me/documents/:type/upload-url
export const DocumentUploadUrlBodySchema = z.object({
  contentType: DocumentContentTypeSchema,
  sizeBytes: z.number().int().positive().max(DOCUMENT_MAX_BYTES),
});
export type DocumentUploadUrlBody = z.infer<typeof DocumentUploadUrlBodySchema>;

/**
 * URL firmada por la API (HMAC y vencimiento) para subir el archivo con PUT, con el mismo
 * Content-Type y como máximo `maxBytes`. El Worker escribe en R2 sin exponer el bucket.
 * Respuesta del PUT: 200 DriverDocument.
 */
export const DocumentUploadUrlResponseSchema = z.object({
  uploadUrl: z.url(),
  method: z.literal('PUT'),
  headers: z.object({ 'content-type': DocumentContentTypeSchema }),
  maxBytes: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
});
export type DocumentUploadUrlResponse = z.infer<typeof DocumentUploadUrlResponseSchema>;

/** URL firmada de lectura (solo ADMIN): GET /admin/drivers/:userId/documents/:type/view-url */
export const DocumentViewUrlResponseSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type DocumentViewUrlResponse = z.infer<typeof DocumentViewUrlResponseSchema>;

export const DriverRoutes = {
  APPLY: '/drivers/apply',
  ME: '/drivers/me',
  /** POST, con :type de DocumentType. */
  DOCUMENT_UPLOAD_URL: '/drivers/me/documents/:type/upload-url',
} as const;

export function documentUploadUrlPath(type: DocumentType): string {
  return `/drivers/me/documents/${type}/upload-url`;
}

// --- Revisión por ADMIN (HU-204) ---

export const AdminDriverRoutes = {
  /** GET ?status=PENDING&cursor=&limit= */
  LIST: '/admin/drivers',
  DETAIL: '/admin/drivers/:userId',
  DOCUMENT_VIEW_URL: '/admin/drivers/:userId/documents/:type/view-url',
  /** POST { decision, reason? } revisa un documento. */
  DOCUMENT_REVIEW: '/admin/drivers/:userId/documents/:type/review',
  /** POST aprueba: exige los 5 documentos APPROVED; otorga DRIVER y publica DriverApproved. */
  APPROVE: '/admin/drivers/:userId/approve',
  /** POST { reason } */
  REJECT: '/admin/drivers/:userId/reject',
  /** POST { reason }: bloquea el modo conductor; conserva la cuenta de pasajero. */
  SUSPEND: '/admin/drivers/:userId/suspend',
  /** POST: vuelve a APPROVED tras una suspensión. */
  REINSTATE: '/admin/drivers/:userId/reinstate',
} as const;

export function adminDriverPath(
  userId: string,
  action?: 'approve' | 'reject' | 'suspend' | 'reinstate',
): string {
  const base = `/admin/drivers/${encodeURIComponent(userId)}`;
  return action ? `${base}/${action}` : base;
}

export function adminDocumentPath(
  userId: string,
  type: DocumentType,
  action: 'view-url' | 'review',
): string {
  return `/admin/drivers/${encodeURIComponent(userId)}/documents/${type}/${action}`;
}

export const AdminDriversQuerySchema = z.object({
  status: DriverVerificationStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminDriversQuery = z.infer<typeof AdminDriversQuerySchema>;

export const AdminDriverSchema = DriverProfileSchema.extend({
  email: z.email(),
  fullName: z.string().nullable(),
  phone: z.string().nullable(),
  reviewedBy: z.string().nullable(),
});
export type AdminDriver = z.infer<typeof AdminDriverSchema>;

export const AdminDriversResponseSchema = z.object({
  items: z.array(AdminDriverSchema),
  nextCursor: z.string().nullable(),
});
export type AdminDriversResponse = z.infer<typeof AdminDriversResponseSchema>;

export const ReasonBodySchema = z.object({ reason: z.string().trim().min(5).max(500) });
export type ReasonBody = z.infer<typeof ReasonBodySchema>;

export const DocumentReviewBodySchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal(DocumentStatus.APPROVED) }),
  z.object({
    decision: z.literal(DocumentStatus.REJECTED),
    reason: z.string().trim().min(5).max(500),
  }),
]);
export type DocumentReviewBody = z.infer<typeof DocumentReviewBodySchema>;
