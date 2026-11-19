// Errores del estimado en español (HU-404). Ninguno inventa un precio: se explica qué pasó y qué
// puede hacer el pasajero (otro punto, otro vehículo o reintentar).
import { ApiErrorCode, type VehicleType } from '@panter/contracts';
import { errorMessage } from '../../../shared/api/error-messages';
import { ClientErrorCode } from '../../../shared/api/errors';
import { VEHICLE_LABELS } from './breakdown';

export type EstimateErrorAction = 'retry' | 'change-destination' | 'change-vehicle';

export interface EstimateErrorView {
  code: string;
  title: string;
  message: string;
  action: EstimateErrorAction;
}

export function estimateErrorView(code: string, vehicle: VehicleType): EstimateErrorView {
  switch (code) {
    case ApiErrorCode.OUT_OF_SERVICE_AREA:
      return {
        code,
        title: 'Fuera de la zona de servicio',
        message:
          'El origen o el destino queda fuera de la zona de PANTER (Villagarzón, Mocoa y el corredor a Puerto Asís). Elige otro punto.',
        action: 'change-destination',
      };
    case ApiErrorCode.ROUTE_NOT_FOUND:
      return {
        code,
        title: 'No hay ruta por carretera',
        message:
          'No encontramos un camino entre esos dos puntos. Mueve el pin a una vía cercana o elige otro destino.',
        action: 'change-destination',
      };
    case ApiErrorCode.ROUTING_UNAVAILABLE:
      return {
        code,
        title: 'No pudimos calcular la ruta',
        message:
          'El servicio de rutas no está disponible en este momento, así que no podemos darte un precio. Intenta de nuevo en unos minutos.',
        action: 'retry',
      };
    case ApiErrorCode.FARE_RULE_NOT_FOUND:
      return {
        code,
        title: 'Tarifa no disponible',
        message: `Todavía no hay una tarifa para ${VEHICLE_LABELS[vehicle].toLowerCase()}. Prueba con otro tipo de vehículo.`,
        action: 'change-vehicle',
      };
    case ClientErrorCode.NETWORK_ERROR:
      return {
        code,
        title: 'Sin conexión',
        message: errorMessage({ code }),
        action: 'retry',
      };
    default:
      return {
        code,
        title: 'No pudimos calcular el precio',
        message: errorMessage({ code }),
        action: 'retry',
      };
  }
}
