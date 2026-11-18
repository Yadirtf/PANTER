import {
  DocumentStatus,
  REQUIRED_DOCUMENTS,
  type DOCUMENT_CONTENT_TYPES,
  type DocumentType,
  type DriverAvailability,
  type DriverDocument,
  type DriverProfile,
  type DriverVerificationStatus,
  type VehicleType,
} from '@panter/contracts';
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

/** Vehículo registrado (placa ya normalizada y validada por DriverApplyBodySchema). */
export interface Vehicle {
  vehicleType: VehicleType;
  plate: string;
  brand: string;
  model: string;
  color: string;
  year: number;
}

/** Perfil de conductor tal como lo guarda el repositorio (tipo propio, sin Drizzle). */
export interface DriverProfileRecord {
  userId: string;
  vehicle: Vehicle;
  verificationStatus: DriverVerificationStatus;
  availability: DriverAvailability;
  /** Motivo del último rechazo o suspensión. */
  rejectionReason: string | null;
  /** ISO 8601 UTC. */
  appliedAt: string;
  reviewedAt: string | null;
  /** id del ADMIN que tomó la última decisión. */
  reviewedBy: string | null;
}

/** Documento vigente de un tipo (driver_documents). */
export interface DriverDocumentRecord {
  userId: string;
  type: DocumentType;
  /** drivers/<userId>/<type>/<uuid> */
  r2Key: string;
  contentType: DocumentContentType;
  sizeBytes: number;
  status: DocumentStatus;
  rejectionReason: string | null;
  uploadedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

const order = (type: DocumentType) => REQUIRED_DOCUMENTS.indexOf(type);

/** Documentos en el orden de REQUIRED_DOCUMENTS (cédula, licencia, tarjeta, SOAT, tecno). */
export function sortDocuments<T extends { type: DocumentType }>(docs: readonly T[]): T[] {
  return [...docs].sort((a, b) => order(a.type) - order(b.type));
}

/** Exigidos que aún no se subieron o fueron rechazados (lo que el solicitante debe corregir). */
export function missingDocuments(docs: readonly Pick<DriverDocumentRecord, 'type' | 'status'>[]) {
  return REQUIRED_DOCUMENTS.filter((type) => {
    const doc = docs.find((d) => d.type === type);
    return !doc || doc.status === DocumentStatus.REJECTED;
  });
}

/** ¿Están los cinco documentos exigidos aprobados? Condición para aprobar (HU-204). */
export function allDocumentsApproved(
  docs: readonly Pick<DriverDocumentRecord, 'type' | 'status'>[],
) {
  return REQUIRED_DOCUMENTS.every((type) =>
    docs.some((d) => d.type === type && d.status === DocumentStatus.APPROVED),
  );
}

/** Documentos exigidos que todavía no están aprobados. */
export function documentsNotApproved(
  docs: readonly Pick<DriverDocumentRecord, 'type' | 'status'>[],
): DocumentType[] {
  return REQUIRED_DOCUMENTS.filter(
    (type) => !docs.some((d) => d.type === type && d.status === DocumentStatus.APPROVED),
  );
}

export function toDriverDocument(doc: DriverDocumentRecord): DriverDocument {
  return {
    type: doc.type,
    status: doc.status,
    contentType: doc.contentType,
    sizeBytes: doc.sizeBytes,
    uploadedAt: doc.uploadedAt,
    reviewedAt: doc.reviewedAt,
    rejectionReason: doc.rejectionReason,
  };
}

/** Vista del perfil para el solicitante (DriverProfile de contracts). */
export function toDriverProfile(
  profile: DriverProfileRecord,
  docs: readonly DriverDocumentRecord[],
): DriverProfile {
  return {
    userId: profile.userId,
    vehicle: { ...profile.vehicle },
    verificationStatus: profile.verificationStatus,
    availability: profile.availability,
    rejectionReason: profile.rejectionReason,
    appliedAt: profile.appliedAt,
    reviewedAt: profile.reviewedAt,
    documents: sortDocuments(docs).map(toDriverDocument),
    missingDocuments: missingDocuments(docs),
  };
}
