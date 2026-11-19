import { ApiErrorCode } from '@panter/contracts';
import { AppError } from '../../../shared/errors/app-error';

const AREA = 'Villagarzón, Mocoa y el corredor a Puerto Asís';

/** Errores de las rutas (HU-305). */
export const RoutingErrors = {
  outOfServiceArea: (point: 'origin' | 'destination') =>
    new AppError(
      ApiErrorCode.OUT_OF_SERVICE_AREA,
      point === 'origin'
        ? `El punto de partida está fuera del área de servicio de PANTER (${AREA}).`
        : `El destino está fuera del área de servicio de PANTER (${AREA}).`,
      { status: 422, details: { point } },
    ),
  routeNotFound: () =>
    new AppError(
      ApiErrorCode.ROUTE_NOT_FOUND,
      'No encontramos un camino por carretera entre esos dos puntos. Acerca el punto a una vía e intenta de nuevo.',
      { status: 422 },
    ),
  unavailable: (retryAfterSeconds?: number) =>
    new AppError(
      ApiErrorCode.ROUTING_UNAVAILABLE,
      'No pudimos calcular la ruta en este momento. Intenta de nuevo en unos minutos.',
      { status: 503, details: retryAfterSeconds ? { retryAfterSeconds } : undefined },
    ),
  /** Límite por usuario: mismo código que la falta de servicio (los clientes ya lo muestran), con 429. */
  rateLimited: (retryAfterSeconds: number) =>
    new AppError(
      ApiErrorCode.ROUTING_UNAVAILABLE,
      `Hiciste muchas consultas de rutas seguidas. Espera unos ${Math.ceil(retryAfterSeconds / 60)} minutos e intenta de nuevo.`,
      { status: 429, details: { retryAfterSeconds } },
    ),
};
