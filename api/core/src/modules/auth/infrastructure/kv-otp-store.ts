import type { OtpRecord, OtpRequestWindow, OtpStore } from '../application/ports';

export const OTP_CODE_PREFIX = 'otp:code:';
export const OTP_RATE_PREFIX = 'otp:rate:';

/** KV exige que la expiración esté al menos 60 s en el futuro. */
const KV_MIN_TTL_SECONDS = 60;

/** Expiración absoluta para KV (segundos epoch), nunca antes del mínimo que acepta KV. */
export function kvExpiration(epochMs: number, nowMs: number = Date.now()): number {
  return Math.ceil(Math.max(epochMs, nowMs + KV_MIN_TTL_SECONDS * 1000) / 1000);
}

/**
 * Adaptador KV del almacén OTP:
 * - `otp:code:<hmac(correo)>` → `{ hash, attempts, expiresAt }`, expira con el código (5 min);
 * - `otp:rate:<hmac(correo)>` → `{ count, resetAt }`, expira al cerrar la ventana (15 min).
 *
 * Las expiraciones son absolutas: actualizar los intentos o el contador no alarga la vida de la
 * clave. KV es eventualmente consistente (hasta ~60 s entre ubicaciones), por lo que el límite
 * de solicitudes y de intentos es aproximado; se acepta en el piloto.
 */
export function createKvOtpStore(kv: KVNamespace, now: () => number = Date.now): OtpStore {
  async function getJson<T>(key: string): Promise<T | null> {
    return kv.get<T>(key, 'json');
  }
  async function putJson(key: string, value: unknown, expiresAtMs: number) {
    await kv.put(key, JSON.stringify(value), { expiration: kvExpiration(expiresAtMs, now()) });
  }
  return {
    getCode: (k) => getJson<OtpRecord>(OTP_CODE_PREFIX + k),
    putCode: (k, record) => putJson(OTP_CODE_PREFIX + k, record, record.expiresAt),
    deleteCode: (k) => kv.delete(OTP_CODE_PREFIX + k),
    getRequestWindow: (k) => getJson<OtpRequestWindow>(OTP_RATE_PREFIX + k),
    putRequestWindow: (k, window) => putJson(OTP_RATE_PREFIX + k, window, window.resetAt),
  };
}
