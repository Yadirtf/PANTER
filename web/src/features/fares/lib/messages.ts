import { ApiErrorCode } from '@panter/contracts';
import { ADMIN_ERROR_MESSAGES } from '@/features/admin/lib/messages';

/** Mensajes de la edición de tarifas (HU-403) para cada código de error. */
export const FARE_ERROR_MESSAGES: Record<string, string> = {
  ...ADMIN_ERROR_MESSAGES,
  [ApiErrorCode.FARE_RULE_NOT_FOUND]:
    'No existe una tarifa para ese tipo de vehículo. Recarga la página.',
  [ApiErrorCode.NOT_FOUND]:
    'No encontramos esa tarifa o geocerca. Puede que ya no exista; recarga la página.',
  [ApiErrorCode.FORBIDDEN]:
    'No tienes permiso para editar tarifas. Esta sección es solo para administradores.',
  [ApiErrorCode.VALIDATION_ERROR]:
    'Algún valor no es válido. Revisa los montos (entre $ 0 y $ 1.000.000), las horas y el redondeo.',
};

const FALLBACK_MESSAGE = 'No pudimos guardar los cambios. Intenta de nuevo.';

export function fareErrorMessage(code: string): string {
  return FARE_ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE;
}
