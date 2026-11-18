// Tipos y puertos de la cola de subida de documentos (HU-203). Los adaptadores nativos
// (expo-file-system, expo-network) están en ../native; las pruebas usan dobles en memoria.
import type {
  DOCUMENT_CONTENT_TYPES,
  DocumentType,
  DocumentUploadUrlBody,
  DocumentUploadUrlResponse,
  DriverDocument,
} from '@panter/contracts';

export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

/**
 * Fase de una subida:
 * - queued: en espera de turno (las subidas van de a una para no saturar los datos móviles);
 * - requestingUrl: pidiendo la URL firmada a la API;
 * - uploading: PUT del archivo en curso (con progreso);
 * - waitingNetwork: sin conexión; se reintenta sola al volver la señal;
 * - retryScheduled: falló por algo pasajero; se reintenta tras el backoff;
 * - failed: rechazo definitivo (tamaño, tipo…); hay que tomar la foto de nuevo.
 */
export type UploadPhase =
  'queued' | 'requestingUrl' | 'uploading' | 'waitingNetwork' | 'retryScheduled' | 'failed';

export interface SignedUpload {
  readonly url: string;
  readonly contentType: DocumentContentType;
  readonly maxBytes: number;
  /** Epoch ms de vencimiento de la URL firmada. */
  readonly expiresAt: number;
}

/** Una subida pendiente. Hay como máximo una por tipo de documento. */
export interface UploadItem {
  readonly id: string;
  readonly type: DocumentType;
  /** Copia de la foto en el almacenamiento propio de la app (sobrevive a reinicios). */
  readonly fileUri: string;
  readonly contentType: DocumentContentType;
  readonly sizeBytes: number;
  /** Epoch ms en que se tomó la foto. */
  readonly createdAt: number;
  /** Intentos fallidos consecutivos (base del backoff). */
  readonly attempts: number;
  readonly phase: UploadPhase;
  /** Progreso del PUT entre 0 y 1 (no se persiste). */
  readonly progress: number;
  readonly signed: SignedUpload | null;
  readonly nextAttemptAt: number | null;
  readonly lastErrorCode: string | null;
}

/** Lo que se guarda en disco: la cola de un usuario. */
export interface PersistedQueue {
  readonly version: 1;
  readonly userId: string;
  readonly items: readonly UploadItem[];
}

export interface UploadQueueStore {
  load(): Promise<PersistedQueue | null>;
  save(queue: PersistedQueue): Promise<void>;
}

export interface DocumentFileStore {
  /** Copia la foto a un archivo propio que no borre el sistema; devuelve su URI y tamaño. */
  persist(sourceUri: string, name: string): Promise<{ uri: string; sizeBytes: number }>;
  remove(uri: string): Promise<void>;
  exists(uri: string): Promise<boolean>;
}

export interface UploadUrlRequester {
  requestUploadUrl(
    type: DocumentType,
    body: DocumentUploadUrlBody,
  ): Promise<DocumentUploadUrlResponse>;
}

export interface PutRequest {
  readonly url: string;
  readonly fileUri: string;
  /** Exactamente los headers que devolvió la API (content-type incluido). */
  readonly headers: Record<string, string>;
  readonly onProgress: (fraction: number) => void;
  readonly signal: AbortSignal;
}

export interface DocumentUploader {
  /** PUT del archivo a la URL firmada. Lanza `ApiError` (NETWORK_ERROR, UPLOAD_URL_INVALID…). */
  put(request: PutRequest): Promise<DriverDocument>;
}

export interface NetworkMonitor {
  isOnline(): Promise<boolean>;
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface Scheduler {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
