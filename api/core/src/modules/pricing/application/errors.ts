import { ApiErrorCode } from '@panter/contracts';
import { AppError } from '../../../shared/errors/app-error';
import type { PolicyIssue } from '../domain/fare-policy';

/** Errores del motor de tarifas (HU-401, HU-402). */
export const PricingErrors = {
  fareRuleNotFound: () =>
    new AppError(
      ApiErrorCode.FARE_RULE_NOT_FOUND,
      'Por ahora no hay una tarifa disponible para ese tipo de vehículo.',
      { status: 404 },
    ),
  geofenceNotFound: () => AppError.notFound('No encontramos esa zona de recargo.'),
  invalidRule: (issues: PolicyIssue[]) =>
    AppError.validation('Revisa la tarifa: hay valores que no cumplen las reglas.', issues),
  invalidPolygon: (issues: PolicyIssue[]) =>
    AppError.validation('Revisa el dibujo de la zona: el polígono no es válido.', issues),
  forbidden: () =>
    new AppError(ApiErrorCode.FORBIDDEN, 'No tienes permiso para realizar esta acción.', {
      status: 403,
    }),
  invalidCursor: () => AppError.validation('El cursor de paginación no es válido.'),
};
