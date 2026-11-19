// Estimados de prueba que cumplen el contrato de POST /fares/estimate.
import { encodePolyline, type FareEstimateResponse, PLACES } from '@panter/contracts';

export function makeEstimate(overrides: Partial<FareEstimateResponse> = {}): FareEstimateResponse {
  return {
    vehicleType: 'TAXI',
    currency: 'COP',
    total: 19_500,
    breakdown: [
      { code: 'BASE', label: 'Banderazo', amount: 4_000 },
      { code: 'DISTANCE', label: 'Distancia (6,3 km)', amount: 9_450 },
      { code: 'TIME', label: 'Tiempo (14 min)', amount: 2_800 },
      { code: 'AIRPORT', label: 'Recargo aeropuerto Cananguchal', amount: 3_000 },
      { code: 'ROUNDING', label: 'Redondeo', amount: 250 },
    ],
    route: {
      distanceMeters: 6_300,
      durationSeconds: 840,
      polyline: encodePolyline([PLACES.VILLAGARZON_CENTER, PLACES.AIRPORT_VGZ]),
    },
    isNight: false,
    validUntil: '2026-11-19T15:10:00.000Z',
    ...overrides,
  };
}
