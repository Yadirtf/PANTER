import { ApiErrorCode } from '@panter/contracts';
import { ADMIN_ERROR_MESSAGES } from '@/features/admin/lib/messages';
import { polygonRejectionMessage } from '@/features/fares/lib/messages';

/** Mensajes del catálogo geográfico (E15: barrios, veredas y lugares) para cada código de error. */
export const CATALOG_ERROR_MESSAGES: Record<string, string> = {
  ...ADMIN_ERROR_MESSAGES,
  [ApiErrorCode.AREA_NAME_TAKEN]:
    'Ya existe un barrio o vereda con ese nombre. Usa otro nombre o edita el que ya existe.',
  [ApiErrorCode.INVALID_POLYGON]:
    'El polígono no es válido: revisa que los lados no se crucen y que quede dentro del área de servicio.',
  [ApiErrorCode.OUT_OF_SERVICE_AREA]:
    'Queda fuera del área de servicio de PANTER (Villagarzón, Mocoa y el corredor a Puerto Asís).',
  [ApiErrorCode.NOT_FOUND]:
    'No encontramos ese barrio o vereda. Puede que ya no exista; recarga la página.',
  [ApiErrorCode.FORBIDDEN]:
    'No tienes permiso para editar el catálogo. Esta sección es solo para administradores.',
  [ApiErrorCode.VALIDATION_ERROR]:
    'Algún dato no es válido. Revisa el nombre (de 2 a 80 caracteres), el tipo y la fuente.',
};

const FALLBACK_MESSAGE = 'No pudimos guardar los cambios. Intenta de nuevo.';

export function catalogErrorMessage(code: string): string {
  return CATALOG_ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE;
}

/** Motivo que la API da al rechazar un polígono: `details.reason` (texto) o el mensaje. */
function invalidPolygonReason(error: { message: string; details?: unknown }): string | null {
  const details = error.details;
  if (details && typeof details === 'object') {
    const reason = (details as { reason?: unknown }).reason;
    if (typeof reason === 'string' && reason.trim()) return reason.trim();
  }
  const message = error.message?.trim();
  return message ? message : null;
}

/**
 * Mensaje completo de un fallo del catálogo: INVALID_POLYGON con el motivo que dio la API
 * (p. ej. el de `ST_IsValidReason` de PostGIS), los problemas del polígono en un
 * VALIDATION_ERROR, y para los demás códigos el mensaje propio en español.
 */
export function catalogFailureMessage(error: {
  code: string;
  message: string;
  details?: unknown;
}): string {
  if (error.code === ApiErrorCode.INVALID_POLYGON) {
    const reason = invalidPolygonReason(error);
    return reason
      ? `La API rechazó el polígono: ${reason.replace(/\.$/, '')}. Corrígelo e intenta de nuevo.`
      : catalogErrorMessage(error.code);
  }
  return polygonRejectionMessage(error) ?? catalogErrorMessage(error.code);
}
