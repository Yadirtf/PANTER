import { OtpRequestResponseSchema, type OtpRequestResponse } from '@panter/contracts';
import { createHttpClient, type HttpClient } from '@/shared/api/http-client';
import {
  SessionNavigationSchema,
  SessionRoutes,
  type SessionNavigation,
} from '../session-contract';

/** Cliente del navegador para los route handlers de la sesión (mismo origen que la web). */
function client(): HttpClient {
  return createHttpClient({ baseUrl: window.location.origin });
}

export function requestCode(email: string): Promise<OtpRequestResponse> {
  return client().post(SessionRoutes.OTP_REQUEST, {
    schema: OtpRequestResponseSchema,
    body: { email },
  });
}

export function verifyCode(body: {
  email: string;
  code: string;
  next?: string;
}): Promise<SessionNavigation> {
  return client().post(SessionRoutes.OTP_VERIFY, { schema: SessionNavigationSchema, body });
}

export function logout(): Promise<SessionNavigation> {
  return client().post(SessionRoutes.LOGOUT, { schema: SessionNavigationSchema });
}
