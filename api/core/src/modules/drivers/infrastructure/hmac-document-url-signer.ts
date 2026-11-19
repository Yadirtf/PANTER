import type { DocumentUrlSigner } from '../application/ports';

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Firma HMAC-SHA256 de las URLs de documentos con DOCUMENT_URL_SECRET (Web Crypto).
 * `verify` usa `crypto.subtle.verify`, que compara la firma en tiempo constante: no se filtra
 * cuántos bytes coinciden.
 */
export function createHmacDocumentUrlSigner(secret: string): DocumentUrlSigner {
  const key = crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return {
    async sign(payload) {
      return toBase64Url(await crypto.subtle.sign('HMAC', await key, encoder.encode(payload)));
    },
    async verify(payload, signature) {
      const bytes = fromBase64Url(signature);
      if (!bytes || bytes.byteLength !== 32) return false;
      return crypto.subtle.verify('HMAC', await key, bytes, encoder.encode(payload));
    },
  };
}
