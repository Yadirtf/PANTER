import { AcceptConsentBodySchema, OtpVerifyBodySchema } from '@panter/contracts';
import { z } from 'zod';

/**
 * Contrato entre el navegador y los route handlers de la web (`/api/session/*`). Los tokens
 * nunca viajan en estos cuerpos: quedan en cookies httpOnly.
 */
export const SessionRoutes = {
  OTP_REQUEST: '/api/session/otp/request',
  OTP_VERIFY: '/api/session/otp/verify',
  LOGOUT: '/api/session/logout',
  /** POST: acepta el aviso de privacidad vigente (HU-109). */
  CONSENT: '/api/session/consent',
} as const;

/** POST /api/session/otp/verify: el cuerpo de /auth/otp/verify más el destino pedido. */
export const SessionVerifyBodySchema = OtpVerifyBodySchema.extend({
  next: z.string().max(2048).optional(),
});
export type SessionVerifyBody = z.infer<typeof SessionVerifyBodySchema>;

/** POST /api/session/consent: el cuerpo de POST /me/consent más el destino tras aceptar. */
export const SessionConsentBodySchema = AcceptConsentBodySchema.extend({
  next: z.string().max(2048).optional(),
});
export type SessionConsentBody = z.infer<typeof SessionConsentBodySchema>;

/** Respuesta de verify y logout: solo datos de navegación. */
export const SessionNavigationSchema = z.object({
  redirectTo: z.string().startsWith('/'),
});
export type SessionNavigation = z.infer<typeof SessionNavigationSchema>;
