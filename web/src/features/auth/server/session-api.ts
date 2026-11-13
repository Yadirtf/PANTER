import {
  AuthRoutes,
  OtpRequestResponseSchema,
  TokenPairResponseSchema,
  type OtpRequestBody,
  type OtpRequestResponse,
  type OtpVerifyBody,
  type TokenPairResponse,
} from '@panter/contracts';
import { z } from 'zod';
import { createHttpClient } from '@/shared/api/http-client';

export interface SessionApiConfig {
  /** URL base de panter-api. */
  apiUrl: string;
  /** Inyectable para pruebas; por defecto el `fetch` global. */
  fetch?: typeof fetch;
}

/** Llamadas de servidor a servidor a la API de identidad (route handlers y middleware). */
export interface SessionApi {
  requestOtp(body: OtpRequestBody): Promise<OtpRequestResponse>;
  verifyOtp(body: OtpVerifyBody): Promise<TokenPairResponse>;
  refresh(refreshToken: string): Promise<TokenPairResponse>;
  logout(refreshToken: string): Promise<void>;
}

export function createSessionApi(config: SessionApiConfig): SessionApi {
  const client = createHttpClient({ baseUrl: config.apiUrl, fetch: config.fetch });
  return {
    requestOtp: (body) =>
      client.post(AuthRoutes.OTP_REQUEST, { schema: OtpRequestResponseSchema, body }),
    verifyOtp: (body) =>
      client.post(AuthRoutes.OTP_VERIFY, { schema: TokenPairResponseSchema, body }),
    refresh: (refreshToken) =>
      client.post(AuthRoutes.REFRESH, {
        schema: TokenPairResponseSchema,
        body: { refreshToken },
      }),
    logout: async (refreshToken) => {
      await client.post(AuthRoutes.LOGOUT, { schema: z.unknown(), body: { refreshToken } });
    },
  };
}
