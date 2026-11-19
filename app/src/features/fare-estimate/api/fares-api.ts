// POST /fares/estimate (HU-402) con el contrato de packages/contracts/src/fares.ts.
import {
  type FareEstimateBody,
  type FareEstimateResponse,
  FareEstimateResponseSchema,
  FareRoutes,
} from '@panter/contracts';
import type { HttpClient } from '../../../shared/api/http-client';

export interface FaresApi {
  /**
   * Errores esperados: 422 OUT_OF_SERVICE_AREA o ROUTE_NOT_FOUND, 503/429 ROUTING_UNAVAILABLE y
   * 404 FARE_RULE_NOT_FOUND.
   */
  estimate(body: FareEstimateBody): Promise<FareEstimateResponse>;
}

export function createFaresApi(http: HttpClient): FaresApi {
  return {
    estimate: (body) =>
      http.request({
        path: FareRoutes.ESTIMATE,
        body,
        auth: true,
        schema: FareEstimateResponseSchema,
      }),
  };
}
