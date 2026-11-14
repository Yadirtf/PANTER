import type { OtpHasher } from './ports';

/** Clave del correo en el almacén: HMAC del correo normalizado (no se guardan correos en claro). */
export function emailKey(hasher: OtpHasher, email: string): Promise<string> {
  return hasher.hmac(`email:${email}`);
}

/** Hash del código, ligado al correo: el mismo código para otro correo da otro hash. */
export function codeHash(hasher: OtpHasher, email: string, code: string): Promise<string> {
  return hasher.hmac(`otp:${email}:${code}`);
}
