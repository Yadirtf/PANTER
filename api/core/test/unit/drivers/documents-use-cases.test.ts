import {
  ApiErrorCode,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_URL_TTL_SECONDS,
  DocumentUploadUrlResponseSchema,
  DriverDocumentSchema,
} from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  makeCreateUploadUrl,
  makeUploadDocument,
} from '../../../src/modules/drivers/application/documents';
import { formatMegabytes } from '../../../src/modules/drivers/application/errors';
import { readLimited } from '../../../src/modules/drivers/application/read-limited';
import type { Actor } from '../../../src/modules/auth/domain/actor';
import {
  baseContentType,
  decodeGrant,
  documentKey,
  encodeGrant,
  splitToken,
  type UploadGrant,
} from '../../../src/modules/drivers/domain/document-url';
import { detectImageType } from '../../../src/modules/drivers/domain/magic-bytes';
import { createHmacDocumentUrlSigner } from '../../../src/modules/drivers/infrastructure/hmac-document-url-signer';
import { AppError } from '../../../src/shared/errors/app-error';
import { manualClock } from '../../support/auth-fakes';
import {
  IMAGES,
  MemoryDocumentStorage,
  MemoryDriverRepository,
  MemoryUploadLedger,
  streamOf,
  userId,
} from '../../support/driver-fakes';

const SECRET = 'test-document-url-secret-0123456789abcdef0123456789';
const ORIGIN = 'https://panter-api-staging.panter.workers.dev';
const KEY_ID = '11111111-2222-4333-8444-555555555555';

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  const err = await promise.then(
    () => {
      throw new Error('se esperaba un error');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

const actor = (n = 1): Actor => ({
  userId: userId(n),
  roles: ['PASSENGER'],
  activeMode: 'passenger',
});

function setup() {
  const clock = manualClock();
  const repo = new MemoryDriverRepository();
  const storage = new MemoryDocumentStorage();
  const ledger = new MemoryUploadLedger();
  const signer = createHmacDocumentUrlSigner(SECRET);
  const createUploadUrl = makeCreateUploadUrl({
    repo,
    signer,
    clock: clock.now,
    newId: () => KEY_ID,
  });
  const upload = makeUploadDocument({ repo, signer, storage, ledger, clock: clock.now });
  async function urlFor(
    contentType: keyof typeof IMAGES = 'image/jpeg',
    sizeBytes = 64,
    type = 'CEDULA' as const,
  ) {
    const res = await createUploadUrl(actor(), { type, contentType, sizeBytes, origin: ORIGIN });
    return { res, token: new URL(res.uploadUrl).searchParams.get('token')! };
  }
  const put = (
    token: string | undefined,
    bytes: Uint8Array,
    contentType = 'image/jpeg',
    contentLength?: string,
  ) =>
    upload({
      token,
      contentType,
      contentLength: contentLength ?? String(bytes.byteLength),
      body: streamOf(bytes),
    });
  return { clock, repo, storage, ledger, signer, createUploadUrl, upload, urlFor, put };
}

describe('URL firmada de subida (HU-202)', () => {
  it('emite la URL del Worker con firma, Content-Type, maxBytes y vencimiento de 10 min', async () => {
    const { repo, urlFor, clock } = setup();
    repo.seed(userId(1));
    const { res, token } = await urlFor('image/png', 5000);
    expect(DocumentUploadUrlResponseSchema.parse(res)).toEqual(res);
    expect(res.uploadUrl.startsWith(`${ORIGIN}/drivers/documents/upload?token=`)).toBe(true);
    expect(res).toMatchObject({
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      maxBytes: 5000,
    });
    expect(Date.parse(res.expiresAt)).toBe(
      Math.floor(clock.now() / 1000) * 1000 + DOCUMENT_URL_TTL_SECONDS * 1000,
    );
    const grant = decodeGrant(splitToken(token)!.payload);
    expect(grant).toMatchObject({
      userId: userId(1),
      type: 'CEDULA',
      contentType: 'image/png',
      maxBytes: 5000,
      key: `drivers/${userId(1)}/CEDULA/${KEY_ID}`,
    });
  });

  it('Content-Type no permitido → 415; más de 8 MB → 413', async () => {
    const { repo, createUploadUrl } = setup();
    repo.seed(userId(1));
    const call = (contentType: string, sizeBytes: number) =>
      createUploadUrl(actor(), { type: 'SOAT', contentType, sizeBytes, origin: ORIGIN });
    expect((await errorOf(call('application/pdf', 10))).code).toBe(
      ApiErrorCode.DOCUMENT_TYPE_NOT_ALLOWED,
    );
    const big = await errorOf(call('image/jpeg', DOCUMENT_MAX_BYTES + 1));
    expect([big.code, big.status]).toEqual([ApiErrorCode.DOCUMENT_TOO_LARGE, 413]);
    expect(big.message).toBe('La foto es muy pesada. El máximo es 8 MB.');
    // Con parámetros y mayúsculas también se reconoce.
    expect((await call('Image/JPEG; charset=binary', 10)).headers['content-type']).toBe(
      'image/jpeg',
    );
  });

  it('sin perfil → 404; APPROVED o SUSPENDED → 409; REJECTED sí puede', async () => {
    const { repo, urlFor } = setup();
    expect((await errorOf(urlFor())).code).toBe(ApiErrorCode.DRIVER_NOT_APPLIED);
    for (const status of ['APPROVED', 'SUSPENDED'] as const) {
      repo.seed(userId(1), status);
      expect((await errorOf(urlFor())).code).toBe(ApiErrorCode.INVALID_DRIVER_TRANSITION);
    }
    repo.seed(userId(1), 'REJECTED');
    await expect(urlFor()).resolves.toBeDefined();
  });

  it('usa reloj, uuid y origen reales por defecto', async () => {
    const repo = new MemoryDriverRepository();
    repo.seed(userId(1));
    const create = makeCreateUploadUrl({ repo, signer: createHmacDocumentUrlSigner(SECRET) });
    const a = await create(actor(), {
      type: 'SOAT',
      contentType: 'image/webp',
      sizeBytes: 9,
      origin: ORIGIN,
    });
    const b = await create(actor(), {
      type: 'SOAT',
      contentType: 'image/webp',
      sizeBytes: 9,
      origin: ORIGIN,
    });
    expect(a.uploadUrl).not.toBe(b.uploadUrl);
    expect(Date.parse(a.expiresAt)).toBeGreaterThan(Date.now());
  });
});

describe('PUT firmado (HU-202)', () => {
  it('guarda en R2 con metadatos, deja SUBMITTED y marca la URL como usada', async () => {
    const { repo, storage, ledger, urlFor, put } = setup();
    repo.seed(userId(1));
    const { token } = await urlFor('image/jpeg', 64);
    const bytes = IMAGES['image/jpeg']();
    const doc = DriverDocumentSchema.parse(await put(token, bytes));
    expect(doc).toMatchObject({
      type: 'CEDULA',
      status: 'SUBMITTED',
      contentType: 'image/jpeg',
      sizeBytes: 12,
    });
    const key = `drivers/${userId(1)}/CEDULA/${KEY_ID}`;
    expect(storage.objects.get(key)).toEqual({
      bytes,
      meta: { contentType: 'image/jpeg', userId: userId(1), type: 'CEDULA' },
    });
    expect(ledger.used.get(key)).toBe(DOCUMENT_URL_TTL_SECONDS);
    expect(repo.documents.get(`${userId(1)}:CEDULA`)?.r2Key).toBe(key);
    // Un solo uso.
    expect((await errorOf(put(token, bytes))).message).toContain('ya se usó');
  });

  it.each(['image/png', 'image/webp'] as const)('acepta %s con sus magic bytes', async (ct) => {
    const { repo, urlFor, put } = setup();
    repo.seed(userId(1));
    const { token } = await urlFor(ct, 64);
    expect((await put(token, IMAGES[ct](), ct)).contentType).toBe(ct);
  });

  it('firma alterada, token mal formado o ausente → 403 UPLOAD_URL_INVALID', async () => {
    const { repo, urlFor, put, signer } = setup();
    repo.seed(userId(1));
    const { token } = await urlFor();
    const { payload, signature } = splitToken(token)!;
    const bytes = IMAGES['image/jpeg']();
    const flipped = signature.slice(0, -2) + (signature.endsWith('AA') ? 'BB' : 'AA');
    // Cambiar el tamaño máximo (o cualquier campo) invalida la firma.
    const grant = decodeGrant(payload)!;
    const bigger = encodeGrant({ ...grant, maxBytes: DOCUMENT_MAX_BYTES });
    for (const bad of [
      `${payload}.${flipped}`,
      `${bigger}.${signature}`,
      'sin-punto',
      `${payload}.`,
      `${payload}.***`,
      undefined,
    ]) {
      const err = await errorOf(put(bad, bytes));
      expect([err.code, err.status]).toEqual([ApiErrorCode.UPLOAD_URL_INVALID, 403]);
    }
    // Firmado con la llave correcta pero con datos incoherentes (otra clave R2) → inválido.
    const forged = encodeGrant({ ...grant, key: 'drivers/otro/CEDULA/x' });
    expect((await errorOf(put(`${forged}.${await signer.sign(forged)}`, bytes))).code).toBe(
      ApiErrorCode.UPLOAD_URL_INVALID,
    );
    // Otro secreto.
    const other = createHmacDocumentUrlSigner('otro-secreto-de-32-caracteres-como-minimo!!');
    expect((await errorOf(put(`${payload}.${await other.sign(payload)}`, bytes))).code).toBe(
      ApiErrorCode.UPLOAD_URL_INVALID,
    );
  });

  it('vencida → 403 UPLOAD_URL_INVALID con mensaje de vencimiento', async () => {
    const { repo, urlFor, put, clock } = setup();
    repo.seed(userId(1));
    const { token } = await urlFor();
    clock.advance(DOCUMENT_URL_TTL_SECONDS * 1000 + 1);
    const err = await errorOf(put(token, IMAGES['image/jpeg']()));
    expect([err.code, err.message]).toEqual([
      ApiErrorCode.UPLOAD_URL_INVALID,
      'El enlace para subir la foto venció. Vuelve a intentarlo desde la app.',
    ]);
  });

  it('Content-Type distinto del firmado → 415', async () => {
    const { repo, urlFor, put } = setup();
    repo.seed(userId(1));
    const { token } = await urlFor('image/jpeg');
    const err = await errorOf(put(token, IMAGES['image/png'](), 'image/png'));
    expect([err.code, err.status]).toEqual([ApiErrorCode.DOCUMENT_TYPE_NOT_ALLOWED, 415]);
  });

  it('magic bytes que no coinciden (PDF o PNG disfrazado de JPEG, vacío) → 415', async () => {
    const { repo, storage, ledger, urlFor, put } = setup();
    repo.seed(userId(1));
    const { token } = await urlFor('image/jpeg');
    const pdf = new TextEncoder().encode('%PDF-1.7 cédula');
    for (const bytes of [pdf, IMAGES['image/png'](), new Uint8Array(0)]) {
      expect((await errorOf(put(token, bytes))).code).toBe(ApiErrorCode.DOCUMENT_TYPE_NOT_ALLOWED);
    }
    expect(storage.objects.size).toBe(0);
    expect(ledger.used.size).toBe(0);
  });

  it('Content-Length mayor que maxBytes → 413 sin leer el cuerpo', async () => {
    const { repo, urlFor, put } = setup();
    repo.seed(userId(1));
    const { token } = await urlFor('image/jpeg', 20);
    const err = await errorOf(put(token, IMAGES['image/jpeg'](), 'image/jpeg', '21'));
    expect([err.code, err.status]).toEqual([ApiErrorCode.DOCUMENT_TOO_LARGE, 413]);
  });

  it('Content-Length que miente o falta: el stream se corta en maxBytes → 413', async () => {
    const { repo, storage, urlFor, upload } = setup();
    repo.seed(userId(1));
    const { token } = await urlFor('image/jpeg', 16);
    const chunk = IMAGES['image/jpeg']();
    for (const contentLength of ['12', undefined, 'abc']) {
      const err = await errorOf(
        upload({ token, contentType: 'image/jpeg', contentLength, body: streamOf(chunk, chunk) }),
      );
      expect(err.code).toBe(ApiErrorCode.DOCUMENT_TOO_LARGE);
    }
    expect(storage.objects.size).toBe(0);
  });

  it('perfil ya aprobado → 409 sin escribir; si cambia durante la subida se borra de R2', async () => {
    const { repo, storage, urlFor, put } = setup();
    repo.seed(userId(1));
    const { token } = await urlFor();
    repo.profiles.get(userId(1))!.verificationStatus = 'APPROVED';
    expect((await errorOf(put(token, IMAGES['image/jpeg']()))).code).toBe(
      ApiErrorCode.INVALID_DRIVER_TRANSITION,
    );
    expect(storage.objects.size).toBe(0);

    repo.profiles.get(userId(1))!.verificationStatus = 'PENDING';
    repo.upsertDocument = async () => null;
    expect((await errorOf(put(token, IMAGES['image/jpeg']()))).code).toBe(
      ApiErrorCode.INVALID_DRIVER_TRANSITION,
    );
    expect(storage.deleted).toEqual([`drivers/${userId(1)}/CEDULA/${KEY_ID}`]);
  });

  it('volver a subir un documento rechazado lo deja en SUBMITTED sin la revisión anterior', async () => {
    const { repo, urlFor, put } = setup();
    repo.seed(userId(1), 'REJECTED');
    repo.documents.set(`${userId(1)}:CEDULA`, {
      userId: userId(1),
      type: 'CEDULA',
      r2Key: 'drivers/x/CEDULA/viejo',
      contentType: 'image/jpeg',
      sizeBytes: 99,
      status: 'REJECTED',
      rejectionReason: 'La foto está borrosa',
      uploadedAt: '2026-11-17T12:00:00.000Z',
      reviewedAt: '2026-11-17T13:00:00.000Z',
      reviewedBy: userId(9),
    });
    const { token } = await urlFor();
    const doc = await put(token, IMAGES['image/jpeg']());
    expect(doc).toMatchObject({ status: 'SUBMITTED', rejectionReason: null, reviewedAt: null });
  });

  it('usa Date.now por defecto', async () => {
    const repo = new MemoryDriverRepository();
    repo.seed(userId(1));
    const signer = createHmacDocumentUrlSigner(SECRET);
    const res = await makeCreateUploadUrl({ repo, signer })(actor(), {
      type: 'LICENCIA',
      contentType: 'image/jpeg',
      sizeBytes: 64,
      origin: ORIGIN,
    });
    const upload = makeUploadDocument({
      repo,
      signer,
      storage: new MemoryDocumentStorage(),
      ledger: new MemoryUploadLedger(),
    });
    const doc = await upload({
      token: new URL(res.uploadUrl).searchParams.get('token') ?? undefined,
      contentType: 'image/jpeg',
      contentLength: undefined,
      body: streamOf(IMAGES['image/jpeg']()),
    });
    expect(doc.type).toBe('LICENCIA');
  });
});

describe('dominio de documentos', () => {
  it('magic bytes de JPEG, PNG y WEBP; lo demás es null', () => {
    expect(detectImageType(IMAGES['image/jpeg']())).toBe('image/jpeg');
    expect(detectImageType(IMAGES['image/png']())).toBe('image/png');
    expect(detectImageType(IMAGES['image/webp']())).toBe('image/webp');
    // RIFF de un WAV no es WEBP.
    expect(detectImageType(new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt '))).toBeNull();
    expect(detectImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it('decodeGrant rechaza lo que no emitió la API', () => {
    const grant: UploadGrant = {
      purpose: 'upload',
      userId: userId(1),
      type: 'SOAT',
      contentType: 'image/jpeg',
      maxBytes: 100,
      key: documentKey(userId(1), 'SOAT', KEY_ID),
      exp: 1_800_000_000,
    };
    expect(decodeGrant(encodeGrant(grant))).toEqual(grant);
    const bad: Partial<Record<keyof UploadGrant, unknown>>[] = [
      { purpose: 'view' },
      { userId: 'no-uuid' },
      { type: 'PASAPORTE' },
      { contentType: 'image/gif' },
      { maxBytes: 0 },
      { maxBytes: DOCUMENT_MAX_BYTES + 1 },
      { maxBytes: 1.5 },
      { exp: 'mañana' },
      { key: `drivers/${userId(1)}/SOAT/no-uuid` },
      { key: 5 },
    ];
    for (const change of bad) {
      expect(decodeGrant(encodeGrant({ ...grant, ...change } as UploadGrant))).toBeNull();
    }
    expect(decodeGrant('%%%')).toBeNull();
    expect(decodeGrant(btoa('no es json'))).toBeNull();
  });

  it('baseContentType quita parámetros y normaliza', () => {
    expect(baseContentType(' Image/PNG ; q=1')).toBe('image/png');
    expect(baseContentType(undefined)).toBe('');
    expect(baseContentType(null)).toBe('');
  });

  it('formatMegabytes en formato colombiano', () => {
    expect(formatMegabytes(8 * 1024 * 1024)).toBe('8 MB');
    expect(formatMegabytes(1_500_000)).toBe('1,4 MB');
  });

  it('readLimited: sin cuerpo da vacío; junta chunks; corta al pasarse', async () => {
    expect(await readLimited(null, 10)).toEqual(new Uint8Array(0));
    const a = new Uint8Array([1, 2, 3]);
    expect(await readLimited(streamOf(a, a), 6)).toEqual(new Uint8Array([1, 2, 3, 1, 2, 3]));
    expect(await readLimited(streamOf(a, a), 5)).toBeNull();
  });
});
