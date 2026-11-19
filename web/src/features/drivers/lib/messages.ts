import { ApiErrorCode } from '@panter/contracts';
import { ADMIN_ERROR_MESSAGES } from '@/features/admin/lib/messages';

/**
 * Mensajes de la revisión de conductores (HU-204). Parte de los de /admin/usuarios (sesión,
 * consentimiento, red) y reemplaza los que en esta pantalla significan otra cosa.
 */
export const DRIVER_ERROR_MESSAGES: Record<string, string> = {
  ...ADMIN_ERROR_MESSAGES,
  [ApiErrorCode.DOCUMENTS_INCOMPLETE]:
    'No se puede aprobar todavía: los 5 documentos deben estar subidos y aprobados. Revisa los que faltan.',
  [ApiErrorCode.INVALID_DRIVER_TRANSITION]:
    'Esa acción no aplica al estado actual del conductor. Puede que otro administrador ya lo haya revisado; recarga la página.',
  [ApiErrorCode.NOT_FOUND]:
    'No encontramos esa solicitud de conductor o ese documento. Puede que ya no exista; vuelve al listado.',
  [ApiErrorCode.FORBIDDEN]:
    'No tienes permiso para revisar conductores. Esta sección es solo para administradores.',
  [ApiErrorCode.VALIDATION_ERROR]:
    'Revisa los datos: el motivo debe tener entre 5 y 500 caracteres.',
};

const FALLBACK_MESSAGE = 'No pudimos completar la acción. Intenta de nuevo.';

export function driverErrorMessage(code: string): string {
  return DRIVER_ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE;
}
