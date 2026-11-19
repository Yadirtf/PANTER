// Paso 2 del onboarding (HU-203): estado de cada uno de los 5 documentos, combinando lo que dice
// la API (GET /drivers/me) con las subidas locales pendientes de la cola.
import {
  DOCUMENT_LABELS,
  DocumentStatus,
  type DocumentType,
  type DriverDocument,
  type DriverProfile,
  REQUIRED_DOCUMENTS,
} from '@panter/contracts';
import { errorMessage } from '../../../shared/api/error-messages';
import type { UploadItem } from '../upload/upload-types';

export type DocumentUiState =
  /** Falta: no se ha subido. */
  | { readonly kind: 'missing' }
  /**
   * Subiendo. `waiting` indica si espera la señal (offline) o un reintento (retry); mientras
   * tanto la foto queda guardada en el teléfono.
   */
  | {
      readonly kind: 'uploading';
      readonly progress: number;
      readonly waiting: 'offline' | 'retry' | null;
    }
  /** La API rechazó la foto antes de registrarla (tamaño, tipo…): hay que tomarla de nuevo. */
  | { readonly kind: 'uploadFailed'; readonly message: string }
  /** En revisión: subido, esperando que un administrador lo revise. */
  | { readonly kind: 'inReview' }
  | { readonly kind: 'approved' }
  | { readonly kind: 'rejected'; readonly reason: string };

export interface DocumentRow {
  readonly type: DocumentType;
  readonly label: string;
  readonly state: DocumentUiState;
}

const DEFAULT_REJECTION =
  'El administrador no indicó el motivo. Toma la foto de nuevo, con buena luz.';

function fromUpload(item: UploadItem): DocumentUiState {
  switch (item.phase) {
    case 'failed':
      return {
        kind: 'uploadFailed',
        message: errorMessage({ code: item.lastErrorCode ?? 'INTERNAL_ERROR' }),
      };
    case 'waitingNetwork':
      return { kind: 'uploading', progress: 0, waiting: 'offline' };
    case 'retryScheduled':
      return { kind: 'uploading', progress: 0, waiting: 'retry' };
    case 'queued':
    case 'requestingUrl':
      return { kind: 'uploading', progress: 0, waiting: null };
    case 'uploading':
      return { kind: 'uploading', progress: item.progress, waiting: null };
  }
}

function fromServer(document: DriverDocument | undefined): DocumentUiState {
  if (!document) return { kind: 'missing' };
  switch (document.status) {
    case DocumentStatus.SUBMITTED:
      return { kind: 'inReview' };
    case DocumentStatus.APPROVED:
      return { kind: 'approved' };
    case DocumentStatus.REJECTED:
      return { kind: 'rejected', reason: document.rejectionReason?.trim() || DEFAULT_REJECTION };
  }
}

/**
 * Una fila por documento exigido, en el orden del contrato. Una subida local pendiente manda
 * sobre lo que diga la API (es una foto más reciente que la que tiene el servidor).
 */
export function documentRows(
  profile: Pick<DriverProfile, 'documents'> | null,
  uploads: readonly UploadItem[],
): DocumentRow[] {
  return REQUIRED_DOCUMENTS.map((type) => {
    const upload = uploads.find((item) => item.type === type);
    const server = profile?.documents.find((document) => document.type === type);
    return {
      type,
      label: DOCUMENT_LABELS[type],
      state: upload ? fromUpload(upload) : fromServer(server),
    };
  });
}

/** Cuenta como entregado lo que está en revisión o aprobado. */
export function isDelivered(state: DocumentUiState): boolean {
  return state.kind === 'inReview' || state.kind === 'approved';
}

export interface DocumentsProgress {
  readonly done: number;
  readonly total: number;
  /** "3 de 5 documentos" */
  readonly label: string;
}

export function documentsProgress(rows: readonly DocumentRow[]): DocumentsProgress {
  const done = rows.filter((row) => isDelivered(row.state)).length;
  const total = rows.length;
  return { done, total, label: `${done} de ${total} documentos` };
}

/** Texto corto del estado para la fila (y para lectores de pantalla). */
export function documentStateLabel(state: DocumentUiState): string {
  switch (state.kind) {
    case 'missing':
      return 'Falta';
    case 'uploading':
      if (state.waiting === 'offline') return 'Sin señal: se subirá al volver la conexión';
      if (state.waiting === 'retry') return 'Reintentando en un momento…';
      return state.progress > 0 ? `Subiendo… ${Math.round(state.progress * 100)} %` : 'Subiendo…';
    case 'uploadFailed':
      return 'No se pudo subir';
    case 'inReview':
      return 'En revisión';
    case 'approved':
      return 'Aprobado';
    case 'rejected':
      return 'Rechazado';
  }
}

/** Se puede tomar (o volver a tomar) la foto, salvo si ya está aprobada. */
export function canCapture(state: DocumentUiState): boolean {
  return state.kind !== 'approved';
}

export interface FramingGuide {
  /** Ancho / alto del recuadro de encuadre. */
  readonly aspectRatio: number;
  readonly hint: string;
}

/** Tamaño tarjeta (ISO/IEC 7810 ID-1: 85,6 × 54 mm). */
const CARD_RATIO = 85.6 / 54;
/** Hoja carta vertical (21,6 × 27,9 cm): SOAT y certificado de revisión impresos. */
const SHEET_RATIO = 21.6 / 27.9;

/** Guía de encuadre en la cámara según el documento. */
export function framingGuideFor(type: DocumentType): FramingGuide {
  switch (type) {
    case 'CEDULA':
      return {
        aspectRatio: CARD_RATIO,
        hint: 'Pon la cédula dentro del recuadro, por el lado de la foto, sin reflejos.',
      };
    case 'LICENCIA':
      return {
        aspectRatio: CARD_RATIO,
        hint: 'Pon la licencia dentro del recuadro, por el lado de la foto y las categorías.',
      };
    case 'TARJETA_PROPIEDAD':
      return {
        aspectRatio: CARD_RATIO,
        hint: 'Pon la tarjeta de propiedad dentro del recuadro; que se lea la placa.',
      };
    case 'SOAT':
      return {
        aspectRatio: SHEET_RATIO,
        hint: 'Encuadra el SOAT completo; que se vean la placa y la fecha de vencimiento.',
      };
    case 'TECNOMECANICA':
      return {
        aspectRatio: SHEET_RATIO,
        hint: 'Encuadra el certificado completo; que se vean la placa y la vigencia.',
      };
  }
}
