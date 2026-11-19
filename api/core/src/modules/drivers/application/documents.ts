import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_URL_TTL_SECONDS,
  type DocumentType,
  type DocumentUploadUrlResponse,
  type DriverDocument,
} from '@panter/contracts';
import type { Actor } from '../../auth/domain/actor';
import {
  baseContentType,
  decodeGrant,
  documentKey,
  encodeGrant,
  isExpired,
  splitToken,
  type UploadGrant,
} from '../domain/document-url';
import { toDriverDocument, type DocumentContentType } from '../domain/driver-profile';
import { canEditDocuments } from '../domain/driver-status';
import { detectImageType } from '../domain/magic-bytes';
import { DriverErrors } from './errors';
import type {
  Clock,
  DocumentStorage,
  DocumentUrlSigner,
  DriverRepository,
  UploadUseLedger,
} from './ports';
import { readLimited } from './read-limited';

/** Ruta del PUT firmado (la sirve este mismo Worker; la autorización es la firma). */
export const DOCUMENT_UPLOAD_PATH = '/drivers/documents/upload';

async function loadEditableProfile(repo: DriverRepository, userId: string) {
  const profile = await repo.findProfile(userId);
  if (!profile) throw DriverErrors.notApplied();
  if (!canEditDocuments(profile.verificationStatus)) throw DriverErrors.documentsLocked();
  return profile;
}

export interface UploadUrlInput {
  type: DocumentType;
  /** Sin validar contra el enum en HTTP, para responder DOCUMENT_TYPE_NOT_ALLOWED. */
  contentType: string;
  sizeBytes: number;
  /** Origen público del Worker (p. ej. https://panter-api-staging….workers.dev). */
  origin: string;
}

/** POST /drivers/me/documents/:type/upload-url */
export type CreateUploadUrl = (
  actor: Actor,
  input: UploadUrlInput,
) => Promise<DocumentUploadUrlResponse>;

/**
 * URL firmada para subir un documento (HU-202). Solo con perfil PENDING o REJECTED. La firma
 * cubre usuario, tipo, Content-Type, tamaño máximo (el declarado), clave R2 nueva y vencimiento
 * (DOCUMENT_URL_TTL_SECONDS).
 */
export function makeCreateUploadUrl(deps: {
  repo: DriverRepository;
  signer: DocumentUrlSigner;
  clock?: Clock;
  newId?: () => string;
}): CreateUploadUrl {
  const now = deps.clock ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  return async (actor, { type, contentType, sizeBytes, origin }) => {
    const ct = baseContentType(contentType);
    if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(ct)) {
      throw DriverErrors.documentTypeNotAllowed();
    }
    if (sizeBytes > DOCUMENT_MAX_BYTES) throw DriverErrors.documentTooLarge(DOCUMENT_MAX_BYTES);
    await loadEditableProfile(deps.repo, actor.userId);

    const exp = Math.floor(now() / 1000) + DOCUMENT_URL_TTL_SECONDS;
    const grant: UploadGrant = {
      purpose: 'upload',
      userId: actor.userId,
      type,
      contentType: ct as DocumentContentType,
      maxBytes: sizeBytes,
      key: documentKey(actor.userId, type, newId()),
      exp,
    };
    const payload = encodeGrant(grant);
    const token = `${payload}.${await deps.signer.sign(payload)}`;
    const url = new URL(DOCUMENT_UPLOAD_PATH, origin);
    url.searchParams.set('token', token);
    return {
      uploadUrl: url.toString(),
      method: 'PUT',
      headers: { 'content-type': grant.contentType },
      maxBytes: grant.maxBytes,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  };
}

export interface UploadInput {
  token: string | undefined;
  contentType: string | undefined;
  /** Content-Length declarado (puede mentir: el cuerpo se corta igual en maxBytes). */
  contentLength: string | undefined;
  body: ReadableStream<Uint8Array> | null;
}

/** PUT de la URL firmada. */
export type UploadDocument = (input: UploadInput) => Promise<DriverDocument>;

/** Verifica firma (tiempo constante) y vencimiento. */
export async function verifyGrant(
  signer: DocumentUrlSigner,
  token: string | undefined,
  nowMs: number,
): Promise<UploadGrant> {
  const parts = token ? splitToken(token) : null;
  if (!parts || !(await signer.verify(parts.payload, parts.signature))) {
    throw DriverErrors.uploadUrlInvalid('invalid');
  }
  const grant = decodeGrant(parts.payload);
  if (!grant) throw DriverErrors.uploadUrlInvalid('invalid');
  if (isExpired(grant, nowMs)) throw DriverErrors.uploadUrlInvalid('expired');
  return grant;
}

/**
 * Recibe el archivo (HU-202), en este orden y sin escribir nada hasta el final:
 * 1. firma válida, no vencida y no usada (KV) → si no, 403 UPLOAD_URL_INVALID;
 * 2. Content-Type igual al firmado → si no, 415 DOCUMENT_TYPE_NOT_ALLOWED;
 * 3. Content-Length declarado y cuerpo real ≤ maxBytes (el stream se corta) → 413;
 * 4. magic bytes del archivo = Content-Type firmado (JPEG, PNG, WEBP) → si no, 415;
 * 5. perfil PENDING o REJECTED;
 * 6. R2 (privado, con metadatos) y upsert en driver_documents como SUBMITTED. Si el perfil
 *    cambió de estado entre la lectura y el upsert, se borra el objeto subido.
 * La URL queda marcada como usada en KV solo si todo salió bien, para que la app pueda
 * reintentar con la misma URL si se cayó la señal a mitad de la subida.
 */
export function makeUploadDocument(deps: {
  repo: DriverRepository;
  signer: DocumentUrlSigner;
  storage: DocumentStorage;
  ledger: UploadUseLedger;
  clock?: Clock;
}): UploadDocument {
  const now = deps.clock ?? Date.now;
  return async ({ token, contentType, contentLength, body }) => {
    const grant = await verifyGrant(deps.signer, token, now());
    if (await deps.ledger.isUsed(grant.key)) throw DriverErrors.uploadUrlInvalid('used');
    if (baseContentType(contentType) !== grant.contentType) {
      throw DriverErrors.documentTypeNotAllowed();
    }
    const declared = contentLength === undefined ? NaN : Number(contentLength);
    if (Number.isFinite(declared) && declared > grant.maxBytes) {
      throw DriverErrors.documentTooLarge(grant.maxBytes);
    }
    await loadEditableProfile(deps.repo, grant.userId);

    const bytes = await readLimited(body, grant.maxBytes);
    if (bytes === null) throw DriverErrors.documentTooLarge(grant.maxBytes);
    if (detectImageType(bytes) !== grant.contentType) throw DriverErrors.documentTypeNotAllowed();

    await deps.storage.put(grant.key, bytes, {
      contentType: grant.contentType,
      userId: grant.userId,
      type: grant.type,
    });
    const doc = await deps.repo.upsertDocument({
      userId: grant.userId,
      type: grant.type,
      r2Key: grant.key,
      contentType: grant.contentType,
      sizeBytes: bytes.byteLength,
    });
    if (!doc) {
      await deps.storage.delete(grant.key);
      throw DriverErrors.documentsLocked();
    }
    const remaining = Math.max(60, grant.exp - Math.floor(now() / 1000));
    await deps.ledger.markUsed(grant.key, remaining);
    return toDriverDocument(doc);
  };
}
