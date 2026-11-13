import type { ActiveMode, Role } from '@panter/contracts';
import type { Actor } from '../domain/actor';
import type { User } from '../domain/user';

/** Código vigente de un correo. Solo se guarda su HMAC, nunca el código. */
export interface OtpRecord {
  hash: string;
  /** Intentos fallidos con este código. */
  attempts: number;
  /** Vencimiento lógico (epoch ms). */
  expiresAt: number;
}

/** Ventana fija del límite de solicitudes de código por correo. */
export interface OtpRequestWindow {
  count: number;
  /** Fin de la ventana (epoch ms). */
  resetAt: number;
}

/**
 * Puerto: almacenamiento temporal del OTP (KV). Las claves son derivadas del correo con HMAC,
 * así el almacén no guarda correos en claro. `expiresAt`/`resetAt` sirven también de TTL.
 *
 * KV es eventualmente consistente: dos peticiones casi simultáneas en ubicaciones distintas
 * pueden leer un valor viejo. Para el piloto se acepta (el límite puede excederse por poco).
 */
export interface OtpStore {
  getCode(emailKey: string): Promise<OtpRecord | null>;
  putCode(emailKey: string, record: OtpRecord): Promise<void>;
  deleteCode(emailKey: string): Promise<void>;
  getRequestWindow(emailKey: string): Promise<OtpRequestWindow | null>;
  putRequestWindow(emailKey: string, window: OtpRequestWindow): Promise<void>;
}

/** Puerto: HMAC-SHA256 con el secreto del servidor (OTP_SECRET), en hexadecimal. */
export interface OtpHasher {
  hmac(value: string): Promise<string>;
}

/** Puerto: entrega el código al usuario (módulo email). */
export type OtpDelivery = (email: string, code: string) => Promise<void>;

/** Puerto: cuentas y roles (Postgres). */
export interface UserRepository {
  /**
   * Devuelve la cuenta del correo o la crea con rol PASSENGER (users + user_roles en una sola
   * sentencia). Idempotente ante carreras: dos llamadas simultáneas devuelven la misma cuenta.
   */
  findOrCreatePassenger(email: string): Promise<User>;
  findById(id: string): Promise<User | null>;
}

/** Reloj inyectable (epoch ms). */
export type Clock = () => number;

// --- Sesión (HU-103) ---

/** Access token firmado y su vigencia en segundos. */
export interface IssuedAccessToken {
  token: string;
  expiresIn: number;
}

/** Puerto: firma access tokens (JWT RS256 con la llave privada). */
export interface AccessTokenSigner {
  sign(subject: {
    userId: string;
    roles: Role[];
    activeMode: ActiveMode;
  }): Promise<IssuedAccessToken>;
}

export type AccessTokenCheck =
  { ok: true; actor: Actor } | { ok: false; reason: 'expired' | 'invalid' };

/** Puerto: verifica access tokens (solo necesita la llave pública). Nunca lanza. */
export interface AccessTokenVerifier {
  verify(token: string): Promise<AccessTokenCheck>;
}

/**
 * Registro de un refresh token en KV, bajo el SHA-256 del token. `rotated` marca un token ya
 * usado: se conserva hasta su vencimiento para detectar reutilización y revocar la familia.
 */
export interface RefreshRecord {
  userId: string;
  activeMode: ActiveMode;
  /** Todos los refresh tokens de una misma sesión (login) comparten familia. */
  familyId: string;
  /** Vencimiento (epoch ms). */
  expiresAt: number;
  rotated?: boolean;
}

/** Puerto: almacén de refresh tokens y familias revocadas (KV). */
export interface RefreshTokenStore {
  get(tokenHash: string): Promise<RefreshRecord | null>;
  put(tokenHash: string, record: RefreshRecord): Promise<void>;
  delete(tokenHash: string): Promise<void>;
  revokeFamily(familyId: string, until: number): Promise<void>;
  isFamilyRevoked(familyId: string): Promise<boolean>;
}

/** Puerto: genera refresh tokens opacos (32 bytes base64url) y calcula su SHA-256. */
export interface RefreshTokenCodec {
  generate(): string;
  hash(token: string): Promise<string>;
}
