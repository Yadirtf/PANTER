// Endpoints de identidad (contrato de packages/contracts/src/auth.ts).
import {
  AuthRoutes,
  type LogoutBody,
  MeResponseSchema,
  type MeResponse,
  type OtpRequestBody,
  OtpRequestResponseSchema,
  type OtpRequestResponse,
  type OtpVerifyBody,
  type RefreshBody,
  type SwitchModeBody,
  SwitchModeResponseSchema,
  type SwitchModeResponse,
  TokenPairResponseSchema,
  type TokenPairResponse,
} from '@panter/contracts';
import type { HttpClient } from '../../../shared/api/http-client';

export interface AuthApi {
  requestOtp(body: OtpRequestBody): Promise<OtpRequestResponse>;
  verifyOtp(body: OtpVerifyBody): Promise<TokenPairResponse>;
  refresh(body: RefreshBody): Promise<TokenPairResponse>;
  /** `accessToken` se envía si está disponible, sin intentar refrescarlo. */
  logout(body: LogoutBody, accessToken?: string): Promise<void>;
  getMe(): Promise<MeResponse>;
  /** POST /me/mode: emite un par de tokens nuevo con el modo pedido. */
  switchMode(body: SwitchModeBody): Promise<SwitchModeResponse>;
}

export function createAuthApi(http: HttpClient): AuthApi {
  return {
    requestOtp: (body) =>
      http.request({ path: AuthRoutes.OTP_REQUEST, body, schema: OtpRequestResponseSchema }),
    verifyOtp: (body) =>
      http.request({ path: AuthRoutes.OTP_VERIFY, body, schema: TokenPairResponseSchema }),
    refresh: (body) =>
      http.request({ path: AuthRoutes.REFRESH, body, schema: TokenPairResponseSchema }),
    logout: (body, accessToken) =>
      http.send({
        path: AuthRoutes.LOGOUT,
        body,
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      }),
    getMe: () => http.request({ path: AuthRoutes.ME, auth: true, schema: MeResponseSchema }),
    switchMode: (body) =>
      http.request({
        path: AuthRoutes.ME_MODE,
        body,
        auth: true,
        schema: SwitchModeResponseSchema,
      }),
  };
}
