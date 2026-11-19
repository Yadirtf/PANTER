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
};
