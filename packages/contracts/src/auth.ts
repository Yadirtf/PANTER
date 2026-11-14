import { z } from 'zod';
import { ActiveModeSchema, RoleSchema } from './enums';

/**
 * Contratos de identidad (M1: HU-101 a HU-108). Especificación §5 y §7.
 * La API valida con estos esquemas y la web y la app los usan para tipar y validar.
 */

/** Rutas de la API de identidad. */
export const AuthRoutes = {
  OTP_REQUEST: '/auth/otp/request',
  OTP_VERIFY: '/auth/otp/verify',
  REFRESH: '/auth/refresh',
  LOGOUT: '/auth/logout',
  JWKS: '/.well-known/jwks.json',
  ME: '/me',
  ME_MODE: '/me/mode',
} as const;

/** Reglas del OTP (§7.4). */
export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_CODES_PER_WINDOW = 3;
export const OTP_WINDOW_SECONDS = 15 * 60;
export const OTP_MAX_VERIFY_ATTEMPTS = 5;
/** Espera antes de permitir "reenviar código" en los clientes (HU-105). */
export const OTP_RESEND_AFTER_SECONDS = 60;

/** Vigencia de los tokens (§7.4). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Correo normalizado: sin espacios y en minúsculas. */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Correo inválido' }).max(254));

export const OtpCodeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), { error: `El código tiene ${OTP_LENGTH} dígitos` });

// POST /auth/otp/request
export const OtpRequestBodySchema = z.object({ email: EmailSchema });
export type OtpRequestBody = z.infer<typeof OtpRequestBodySchema>;

/**
 * Respuesta 202. Es la misma exista o no la cuenta (no revela si el correo está registrado).
 */
export const OtpRequestResponseSchema = z.object({
  status: z.literal('sent'),
  expiresInSeconds: z.number().int().positive(),
  resendAfterSeconds: z.number().int().nonnegative(),
});
export type OtpRequestResponse = z.infer<typeof OtpRequestResponseSchema>;

// POST /auth/otp/verify
export const OtpVerifyBodySchema = z.object({ email: EmailSchema, code: OtpCodeSchema });
export type OtpVerifyBody = z.infer<typeof OtpVerifyBodySchema>;

/** Estado de la cuenta (enum `user_status` de la base de datos). */
export const UserStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

/** Perfil de la sesión actual: GET /me y parte de la respuesta de login. */
export const MeResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string().nullable(),
  phone: z.string().nullable(),
  status: UserStatusSchema,
  roles: z.array(RoleSchema).min(1),
  activeMode: ActiveModeSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** Respuesta de login (verify) y de refresh. */
export const TokenPairResponseSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string().min(1),
  /** Segundos de vigencia del access token. */
  expiresIn: z.number().int().positive(),
  /** Refresh token opaco. Se rota en cada uso: el anterior queda revocado. */
  refreshToken: z.string().min(1),
  refreshExpiresIn: z.number().int().positive(),
  user: MeResponseSchema,
});
export type TokenPairResponse = z.infer<typeof TokenPairResponseSchema>;

// POST /auth/refresh y POST /auth/logout
export const RefreshBodySchema = z.object({ refreshToken: z.string().min(1) });
export type RefreshBody = z.infer<typeof RefreshBodySchema>;
export const LogoutBodySchema = RefreshBodySchema;
export type LogoutBody = RefreshBody;

// POST /me/mode
export const SwitchModeBodySchema = z.object({ mode: ActiveModeSchema });
export type SwitchModeBody = z.infer<typeof SwitchModeBodySchema>;

/**
 * Claims del access token (JWT RS256, §5.3 y §7.4). Los clientes pueden decodificarlo para
 * navegar, pero la autorización real siempre la decide la API.
 */
export const JWT_ISSUER = 'panter-api';
export const JWT_AUDIENCE = 'panter';
export const AccessTokenClaimsSchema = z.object({
  sub: z.uuid(),
  roles: z.array(RoleSchema).min(1),
  activeMode: ActiveModeSchema,
  iss: z.literal(JWT_ISSUER),
  aud: z.union([z.literal(JWT_AUDIENCE), z.array(z.string()).nonempty()]),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().optional(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;
