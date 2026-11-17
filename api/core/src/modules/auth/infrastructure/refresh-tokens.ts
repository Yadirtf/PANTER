import type { RefreshRecord, RefreshTokenCodec, RefreshTokenStore } from '../application/ports';
import { toHex } from './hmac-otp-hasher';
import { kvExpiration } from './kv-otp-store';

export const REFRESH_TOKEN_BYTES = 32;
export const REFRESH_PREFIX = 'refresh:';
export const REFRESH_FAMILY_PREFIX = 'refresh-family:';

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Refresh token opaco: 32 bytes de `crypto.getRandomValues` en base64url (43 caracteres). */
export function createRefreshTokenCodec(): RefreshTokenCodec {
  return {
    generate() {
      return base64url(crypto.getRandomValues(new Uint8Array(REFRESH_TOKEN_BYTES)));
    },
    async hash(token) {
      return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
    },
  };
}

/**
 * Adaptador KV de refresh tokens:
 * - `refresh:<sha256(token)>` → `{ userId, activeMode, familyId, expiresAt, rotated? }`, con
 *   expiración absoluta a los 30 días de emitido (rotarlo no alarga la vida del registro);
 * - `refresh-family:<familyId>` → `"revoked"`, mientras pueda quedar un token de esa familia.
 *
 * KV es eventualmente consistente: un token rotado o una familia revocada pueden tardar hasta
 * ~60 s en verse en otras ubicaciones. La reutilización se detecta igual en cuanto propaga.
 */
export function createKvRefreshTokenStore(
  kv: KVNamespace,
  now: () => number = Date.now,
): RefreshTokenStore {
  return {
    get: (hash) => kv.get<RefreshRecord>(REFRESH_PREFIX + hash, 'json'),
    put: (hash, record) =>
      kv.put(REFRESH_PREFIX + hash, JSON.stringify(record), {
        expiration: kvExpiration(record.expiresAt, now()),
      }),
    delete: (hash) => kv.delete(REFRESH_PREFIX + hash),
    revokeFamily: (familyId, until) =>
      kv.put(REFRESH_FAMILY_PREFIX + familyId, 'revoked', {
        expiration: kvExpiration(until, now()),
      }),
    isFamilyRevoked: async (familyId) => (await kv.get(REFRESH_FAMILY_PREFIX + familyId)) !== null,
  };
}
