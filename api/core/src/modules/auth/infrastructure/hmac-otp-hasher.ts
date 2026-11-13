import type { OtpHasher } from '../application/ports';

/** Bytes → hexadecimal en minúsculas. */
export function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA256 con WebCrypto (disponible en Workers y en Node ≥ 20). */
export function createHmacOtpHasher(secret: string): OtpHasher {
  const encoder = new TextEncoder();
  const key = crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return {
    async hmac(value) {
      return toHex(await crypto.subtle.sign('HMAC', await key, encoder.encode(value)));
    },
  };
}
