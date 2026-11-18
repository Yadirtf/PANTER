import { ApiErrorCode } from '@panter/contracts';
import { ClientErrorCode } from '@/shared/api/errors';

const SESSION_ENDED = 'Tu sesión terminó. Vuelve a iniciar sesión.';

/** Mensajes de la gestión de usuarios y roles (HU-108) para cada código de error. */
export const ADMIN_ERROR_MESSAGES: Record<string, string> = {
  [ApiErrorCode.CANNOT_REVOKE_OWN_ADMIN]:
    'No puedes quitarte tu propio rol de administrador. Pídeselo a otro administrador.',
  [ApiErrorCode.ROLE_NOT_GRANTABLE]:
    'Ese rol no se puede otorgar ni retirar aquí. Solo se gestionan Administrador, Despacho y Operador turístico.',
  [ApiErrorCode.FORBIDDEN]:
    'No tienes permiso para gestionar usuarios. Esta sección es solo para administradores.',
  [ApiErrorCode.NOT_FOUND]: 'No encontramos ese usuario. Puede que ya no exista; recarga la lista.',
  [ApiErrorCode.VALIDATION_ERROR]: 'Revisa la búsqueda e intenta de nuevo.',
  [ApiErrorCode.BAD_REQUEST]: 'Revisa los datos e intenta de nuevo.',
  [ApiErrorCode.UNAUTHENTICATED]: SESSION_ENDED,
  [ApiErrorCode.TOKEN_EXPIRED]: SESSION_ENDED,
  [ApiErrorCode.REFRESH_TOKEN_INVALID]: SESSION_ENDED,
  [ApiErrorCode.ACCOUNT_SUSPENDED]:
    'Tu cuenta está suspendida. Comunícate con otro administrador de PANTER.',
  [ApiErrorCode.INTERNAL_ERROR]: 'Tuvimos un problema. Intenta de nuevo en un momento.',
  [ClientErrorCode.NETWORK_ERROR]:
    'No pudimos conectar con PANTER. Revisa tu conexión e intenta de nuevo.',
};

const FALLBACK_MESSAGE = 'No pudimos completar la acción. Intenta de nuevo.';

export function adminErrorMessage(code: string): string {
  return ADMIN_ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE;
}

/** Errores tras los cuales hay que volver a iniciar sesión. */
export function requiresLogin(code: string): boolean {
  return (
    code === ApiErrorCode.UNAUTHENTICATED ||
    code === ApiErrorCode.TOKEN_EXPIRED ||
    code === ApiErrorCode.REFRESH_TOKEN_INVALID
  );
}
