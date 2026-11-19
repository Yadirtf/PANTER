import type { DocumentType } from '@panter/contracts';
import type {
  DocumentContentType,
  DriverDocumentRecord,
  DriverProfileRecord,
  Vehicle,
} from '../domain/driver-profile';

/** Resultado de crear la solicitud (una sola sentencia; la placa la protege el índice único). */
export type CreateProfileResult =
  { ok: true; profile: DriverProfileRecord } | { ok: false; reason: 'exists' | 'plate_taken' };

/** Resultado de reenviar una solicitud rechazada (condicionado a verification_status REJECTED). */
export type ResubmitResult =
  | { ok: true; profile: DriverProfileRecord }
  | { ok: false; reason: 'not_rejected' | 'plate_taken' };

/** Puerto: perfil y documentos del solicitante (Postgres: driver_profiles, driver_documents). */
export interface DriverRepository {
  findProfile(userId: string): Promise<DriverProfileRecord | null>;
  listDocuments(userId: string): Promise<DriverDocumentRecord[]>;
  /** Crea el perfil PENDING y OFFLINE. No toca user_roles: DRIVER llega al aprobar. */
  create(userId: string, vehicle: Vehicle): Promise<CreateProfileResult>;
  /** REJECTED → PENDING con el vehículo nuevo; limpia el motivo y la revisión anterior. */
  resubmit(userId: string, vehicle: Vehicle): Promise<ResubmitResult>;
  /**
   * HU-202: guarda el documento vigente de ese tipo como SUBMITTED y limpia la revisión
   * anterior (motivo, fecha y revisor). Solo si el perfil está PENDING o REJECTED, en la misma
   * sentencia; si no, devuelve null y no escribe nada.
   */
  upsertDocument(input: NewDocumentInput): Promise<DriverDocumentRecord | null>;
}

export interface NewDocumentInput {
  userId: string;
  type: DocumentType;
  r2Key: string;
  contentType: DocumentContentType;
  sizeBytes: number;
}

/** Puerto: archivos privados de documentos (R2, binding DOCUMENTS). Nunca públicos. */
export interface DocumentStorage {
  put(
    key: string,
    bytes: Uint8Array,
    meta: { contentType: DocumentContentType; userId: string; type: DocumentType },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Puerto: firma HMAC-SHA256 de las URLs de documentos (secreto DOCUMENT_URL_SECRET). */
export interface DocumentUrlSigner {
  /** Firma en base64url. */
  sign(payload: string): Promise<string>;
  /** Comparación en tiempo constante. Nunca lanza: firma mal formada → false. */
  verify(payload: string, signature: string): Promise<boolean>;
}

/** Puerto: registro de URLs de subida ya usadas (KV), para que sean de un solo uso. */
export interface UploadUseLedger {
  isUsed(key: string): Promise<boolean>;
  /** Marca la clave como usada hasta que la URL venza (`ttlSeconds`). */
  markUsed(key: string, ttlSeconds: number): Promise<void>;
}

/** Reloj inyectable (epoch ms). */
export type Clock = () => number;
