import type { DriverDocumentRecord, DriverProfileRecord, Vehicle } from '../domain/driver-profile';

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
}

/** Reloj inyectable (epoch ms). */
export type Clock = () => number;
