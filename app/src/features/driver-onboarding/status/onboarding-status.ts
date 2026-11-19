// Estado de la solicitud de conductor para la pantalla de onboarding (HU-205): qué mostrar según
// `verificationStatus` de GET /drivers/me y qué avisar cuando cambia entre dos consultas.
import {
  DOCUMENT_LABELS,
  type DocumentType,
  DriverVerificationStatus,
  type DriverProfile,
} from '@panter/contracts';
import { type DocumentRow, isDelivered } from '../documents/document-states';

export type OnboardingView =
  /** Aún no ha solicitado: paso 1 (vehículo). */
  | { readonly kind: 'notApplied' }
  /** En revisión; `missing` son los documentos que faltan por entregar (vacío: todo entregado). */
  | {
      readonly kind: 'pending';
      readonly missing: readonly DocumentType[];
      readonly title: string;
      readonly message: string;
    }
  /** Rechazada: motivo y qué corregir (vehículo o solo los documentos rechazados). */
  | {
      readonly kind: 'rejected';
      readonly reason: string;
      readonly toFix: readonly DocumentType[];
      readonly message: string;
    }
  | { readonly kind: 'approved'; readonly title: string; readonly message: string }
  | { readonly kind: 'suspended'; readonly reason: string; readonly message: string };

const NO_REASON = 'El administrador no indicó el motivo. Comunícate con PANTER para saber más.';

export function listLabels(types: readonly DocumentType[]): string {
  const labels = types.map((type) => DOCUMENT_LABELS[type]);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}`;
}

/** Vista de la pantalla a partir del perfil y de las filas de documentos (API + cola local). */
export function onboardingView(
  profile: DriverProfile | null,
  rows: readonly DocumentRow[],
): OnboardingView {
  if (!profile) return { kind: 'notApplied' };
  const reason = profile.rejectionReason?.trim() || NO_REASON;

  switch (profile.verificationStatus) {
    case DriverVerificationStatus.PENDING: {
      const missing = rows.filter((row) => !isDelivered(row.state)).map((row) => row.type);
      return missing.length === 0
        ? {
            kind: 'pending',
            missing,
            title: 'Solicitud en revisión',
            message:
              'Recibimos tus 5 documentos. Un administrador de PANTER los está revisando; aquí verás el resultado.',
          }
        : {
            kind: 'pending',
            missing,
            title: 'Completa tus documentos',
            message: `Te falta entregar: ${listLabels(missing)}. Cuando estén los 5, revisamos tu solicitud.`,
          };
    }
    case DriverVerificationStatus.REJECTED: {
      const toFix = rows
        .filter((row) => row.state.kind === 'rejected' || row.state.kind === 'uploadFailed')
        .map((row) => row.type);
      const missing = rows.filter((row) => row.state.kind === 'missing').map((row) => row.type);
      const all = [...toFix, ...missing];
      return {
        kind: 'rejected',
        reason,
        toFix: all,
        message:
          all.length > 0
            ? `Vuelve a tomar la foto de: ${listLabels(all)}. Si el problema es el vehículo, corrige sus datos.`
            : 'Revisa el motivo y corrige los datos del vehículo para enviar de nuevo tu solicitud.',
      };
    }
    case DriverVerificationStatus.APPROVED:
      return {
        kind: 'approved',
        title: '¡Ya eres conductor!',
        message: 'Tu solicitud fue aprobada. Pasa a modo conductor para empezar a recibir viajes.',
      };
    case DriverVerificationStatus.SUSPENDED:
      return {
        kind: 'suspended',
        reason,
        message:
          'Tu modo conductor está suspendido. Puedes seguir usando PANTER como pasajero con normalidad.',
      };
  }
}

export interface StatusNotice {
  readonly tone: 'success' | 'warning' | 'info';
  readonly message: string;
}

/**
 * Aviso cuando el estado cambia entre dos consultas (primer plano, deslizar, push de E10).
 * La primera carga (`previous` undefined) no avisa: la pantalla ya muestra el estado.
 */
export function statusTransition(
  previous: DriverVerificationStatus | null | undefined,
  next: DriverVerificationStatus | null,
): StatusNotice | null {
  if (previous === undefined || previous === next || next === null) return null;
  switch (next) {
    case DriverVerificationStatus.APPROVED:
      return previous === DriverVerificationStatus.SUSPENDED
        ? { tone: 'success', message: 'Se levantó la suspensión: ya puedes volver a conducir.' }
        : { tone: 'success', message: '¡Tu solicitud fue aprobada!' };
    case DriverVerificationStatus.REJECTED:
      return {
        tone: 'warning',
        message: 'Tu solicitud fue rechazada. Revisa el motivo y lo que debes corregir.',
      };
    case DriverVerificationStatus.SUSPENDED:
      return { tone: 'warning', message: 'Tu modo conductor fue suspendido.' };
    case DriverVerificationStatus.PENDING:
      return previous === null
        ? { tone: 'info', message: 'Recibimos tu solicitud. Ahora sube tus documentos.' }
        : {
            tone: 'info',
            message: 'Recibimos tu corrección. Tu solicitud está otra vez en revisión.',
          };
  }
}
