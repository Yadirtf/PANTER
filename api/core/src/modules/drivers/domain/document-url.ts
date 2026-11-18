import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  DocumentType,
  type DocumentType as DocumentTypeValue,
} from '@panter/contracts';
import type { DocumentContentType } from './driver-profile';

/**
 * Datos firmados de una URL de subida (HU-202). La firma HMAC-SHA256 (infraestructura) cubre el
 * texto base64url de este JSON, así que cambiar cualquier campo invalida la URL:
 * dueño, tipo de documento, Content-Type, tamaño máximo, clave R2 y vencimiento.
 */
export interface UploadGrant {
  purpose: 'upload';
  userId: string;
  type: DocumentTypeValue;
  contentType: DocumentContentType;
  maxBytes: number;
  /** drivers/<userId>/<type>/<uuid>: el uuid hace la clave (y la URL) de un solo uso. */
  key: string;
  /** Vencimiento en segundos epoch. */
  exp: number;
}

export type DocumentUrlGrant = UploadGrant;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Clave del objeto en R2 (nunca pública): drivers/<userId>/<type>/<uuid>. */
export function documentKey(userId: string, type: DocumentTypeValue, id: string): string {
  return `drivers/${userId}/${type}/${id}`;
}

function toBase64Url(text: string): string {
  let binary = '';
  for (const b of new TextEncoder().encode(text)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** JSON compacto de la concesión en base64url: es el texto que se firma. */
export function encodeGrant(grant: DocumentUrlGrant): string {
  return toBase64Url(
    JSON.stringify({
      p: grant.purpose,
      u: grant.userId,
      t: grant.type,
      ct: grant.contentType,
      mb: grant.maxBytes,
      k: grant.key,
      exp: grant.exp,
    }),
  );
}

const isType = (v: unknown): v is DocumentTypeValue =>
  typeof v === 'string' && (Object.values(DocumentType) as string[]).includes(v);
const isContentType = (v: unknown): v is DocumentContentType =>
  typeof v === 'string' && (DOCUMENT_CONTENT_TYPES as readonly string[]).includes(v);

/** Concesión de una URL, o null si no es una emitida por la API (formato o datos incoherentes). */
export function decodeGrant(encoded: string): DocumentUrlGrant | null {
  try {
    const raw = JSON.parse(fromBase64Url(encoded)) as Record<string, unknown>;
    const { p, u, t, ct, mb, k, exp } = raw;
    if (p !== 'upload') return null;
    if (typeof u !== 'string' || !UUID.test(u) || !isType(t) || !isContentType(ct)) return null;
    if (typeof mb !== 'number' || !Number.isInteger(mb) || mb <= 0 || mb > DOCUMENT_MAX_BYTES) {
      return null;
    }
    if (typeof exp !== 'number' || !Number.isInteger(exp)) return null;
    if (typeof k !== 'string' || !k.startsWith(`drivers/${u}/${t}/`)) return null;
    if (!UUID.test(k.slice(`drivers/${u}/${t}/`.length))) return null;
    return { purpose: p, userId: u, type: t, contentType: ct, maxBytes: mb, key: k, exp };
  } catch {
    return null;
  }
}

/** Token de la URL: `<concesión base64url>.<firma base64url>`. */
export function splitToken(token: string): { payload: string; signature: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { payload: parts[0], signature: parts[1] };
}

export function isExpired(grant: Pick<DocumentUrlGrant, 'exp'>, nowMs: number): boolean {
  return grant.exp * 1000 <= nowMs;
}

/** Content-Type de la petición sin parámetros (`image/jpeg; charset=…` → `image/jpeg`). */
export function baseContentType(header: string | null | undefined): string {
  return (header ?? '').split(';')[0]!.trim().toLowerCase();
}
