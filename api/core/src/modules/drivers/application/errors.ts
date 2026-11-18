import { ApiErrorCode } from '@panter/contracts';
import { AppError } from '../../../shared/errors/app-error';

/** Errores del onboarding de conductores (E2), con mensajes para usuarios de Villagarzón. */
export const DriverErrors = {
  alreadyApplied: () =>
    new AppError(
      ApiErrorCode.DRIVER_ALREADY_APPLIED,
      'Ya enviaste tu solicitud para ser conductor. Revisa su estado en la app.',
      { status: 409 },
    ),
  notApplied: () =>
    new AppError(
      ApiErrorCode.DRIVER_NOT_APPLIED,
      'Todavía no has solicitado ser conductor. Registra tu vehículo para empezar.',
      { status: 404 },
    ),
  plateTaken: () =>
    new AppError(
      ApiErrorCode.PLATE_ALREADY_REGISTERED,
      'Esa placa ya está registrada por otro conductor. Revísala o comunícate con PANTER.',
      { status: 409 },
    ),
  // --- Documentos (HU-202) ---
  documentsLocked: () =>
    new AppError(
      ApiErrorCode.INVALID_DRIVER_TRANSITION,
      'Tu solicitud ya fue revisada: no puedes cambiar los documentos. Comunícate con PANTER si necesitas actualizarlos.',
      { status: 409 },
    ),
  documentTooLarge: (maxBytes: number) =>
    new AppError(
      ApiErrorCode.DOCUMENT_TOO_LARGE,
      `La foto es muy pesada. El máximo es ${formatMegabytes(maxBytes)}.`,
      { status: 413, details: { maxBytes } },
    ),
  documentTypeNotAllowed: () =>
    new AppError(
      ApiErrorCode.DOCUMENT_TYPE_NOT_ALLOWED,
      'Solo se aceptan fotos en formato JPG, PNG o WEBP.',
      { status: 415 },
    ),
  uploadUrlInvalid: (reason: 'invalid' | 'expired' | 'used') =>
    new AppError(ApiErrorCode.UPLOAD_URL_INVALID, UPLOAD_URL_MESSAGES[reason], { status: 403 }),
};

const UPLOAD_URL_MESSAGES = {
  invalid: 'El enlace para subir la foto no es válido. Vuelve a intentarlo desde la app.',
  expired: 'El enlace para subir la foto venció. Vuelve a intentarlo desde la app.',
  used: 'Ese enlace para subir la foto ya se usó. Vuelve a intentarlo desde la app.',
} as const;

/** 8388608 → "8 MB"; 1500000 → "1,4 MB" (formato colombiano). */
export function formatMegabytes(bytes: number): string {
  const mb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  return `${String(mb).replace('.', ',')} MB`;
}
