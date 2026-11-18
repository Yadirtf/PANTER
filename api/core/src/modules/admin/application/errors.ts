import { ApiErrorCode } from '@panter/contracts';
import { AppError } from '../../../shared/errors/app-error';

/** Errores de la gestión de roles de personal (HU-108). */
export const AdminErrors = {
  roleNotGrantable: () =>
    new AppError(
      ApiErrorCode.ROLE_NOT_GRANTABLE,
      'Ese rol no se asigna desde aquí. Solo se gestionan ADMIN, DISPATCHER y TOUR_OPERATOR.',
      { status: 400 },
    ),
  cannotRevokeOwnAdmin: () =>
    new AppError(
      ApiErrorCode.CANNOT_REVOKE_OWN_ADMIN,
      'No puedes quitarte tu propio rol de administrador. Pídeselo a otro administrador.',
      { status: 409 },
    ),
  userNotFound: () => AppError.notFound('No encontramos ese usuario.'),
  forbidden: () =>
    new AppError(ApiErrorCode.FORBIDDEN, 'No tienes permiso para realizar esta acción.', {
      status: 403,
    }),
  invalidCursor: () => AppError.validation('El cursor de paginación no es válido.'),
};
