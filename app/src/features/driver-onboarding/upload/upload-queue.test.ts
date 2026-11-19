import { ApiErrorCode, DOCUMENT_MAX_BYTES, type DriverDocument } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError, networkError } from '../../../shared/api/errors';
import { deferred } from '../../../test/fake-api';
import {
  FakeNetwork,
  FakeScheduler,
  FakeUploader,
  FakeUrlApi,
  makeDocument,
  MemoryFiles,
  MemoryQueueStore,
  signedUrl,
  USER_ID,
} from '../test-helpers';
import {
  BACKOFF_BASE_MS,
  backoffDelayMs,
  classifyUploadError,
  isOnlineState,
} from './upload-policy';
import { UploadQueue } from './upload-queue';
import type { UploadPhase } from './upload-types';

function setup(options: { store?: MemoryQueueStore; files?: MemoryFiles; online?: boolean } = {}) {
  const store = options.store ?? new MemoryQueueStore();
  const files = options.files ?? new MemoryFiles();
  const network = new FakeNetwork();
  network.online = options.online ?? true;
  const scheduler = new FakeScheduler();
  const api = new FakeUrlApi();
  const uploader = new FakeUploader();
  const queue = new UploadQueue({
    store,
    files,
    api,
    uploader,
    network,
    scheduler,
    random: () => 0.5, // sin variación: backoff exacto
  });
  const uploaded: DriverDocument[] = [];
  queue.onUploaded((document) => uploaded.push(document));
  const phases: UploadPhase[] = [];
  const progress: number[] = [];
  queue.subscribe(() => {
    const item = queue.getSnapshot().items[0];
    if (item && phases.at(-1) !== item.phase) phases.push(item.phase);
    if (item?.phase === 'uploading') progress.push(item.progress);
  });
  return { queue, store, files, network, scheduler, api, uploader, uploaded, phases, progress };
}

/** Deja correr los callbacks pendientes (la cola trabaja en segundo plano). */
const tick = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

const photo = {
  type: 'CEDULA',
  sourceUri: 'file:///cache/cedula.jpg',
  contentType: 'image/jpeg',
} as const;

describe('UploadQueue · éxito', () => {
  it('pide la URL firmada, hace PUT con el content-type exacto y reporta el progreso', async () => {
    const t = setup();
    await t.queue.start(USER_ID);
    const item = await t.queue.enqueue(photo);
    await t.queue.idle();

    expect(t.api.calls).toEqual([
      { type: 'CEDULA', body: { contentType: 'image/jpeg', sizeBytes: 400_000 } },
    ]);
    expect(t.uploader.calls).toHaveLength(1);
    expect(t.uploader.calls[0]).toMatchObject({
      url: 'https://api.test/uploads/CEDULA?sig=1',
      fileUri: item.fileUri,
      headers: { 'content-type': 'image/jpeg' },
    });
    expect(t.phases).toEqual(['queued', 'requestingUrl', 'uploading']);
    expect(t.progress).toEqual([0, 0.5, 1]);
    expect(t.uploaded).toEqual([makeDocument('CEDULA')]);
    // Terminada: sale de la cola, se borra la copia y se guarda la cola vacía.
    expect(t.queue.getSnapshot().items).toEqual([]);
    expect(t.files.files.size).toBe(0);
    expect(t.store.saved).toEqual({ version: 1, userId: USER_ID, items: [] });
  });

  it('sube de a un documento, en el orden en que se tomaron', async () => {
    const t = setup();
    await t.queue.start(USER_ID);
    let active = 0;
    let maxActive = 0;
    t.uploader.handler = async (request) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return makeDocument(/uploads\/([A-Z_]+)/.exec(request.url)?.[1] as 'CEDULA');
    };
    await t.queue.enqueue(photo);
    t.scheduler.current += 1;
    await t.queue.enqueue({ ...photo, type: 'SOAT', sourceUri: 'file:///cache/soat.jpg' });
    await t.queue.idle();

    expect(maxActive).toBe(1);
    expect(t.uploaded.map((d) => d.type)).toEqual(['CEDULA', 'SOAT']);
  });
});

describe('UploadQueue · sin red', () => {
  it('sin conexión guarda la foto en espera y la sube sola al volver la señal', async () => {
    const t = setup({ online: false });
    await t.queue.start(USER_ID);
    await t.queue.enqueue(photo);
    await t.queue.idle();

    expect(t.queue.getSnapshot()).toMatchObject({
      online: false,
      items: [{ type: 'CEDULA', phase: 'waitingNetwork' }],
    });
    expect(t.api.calls).toHaveLength(0);
    expect(t.store.saved?.items).toHaveLength(1);

    t.network.set(true);
    await t.queue.idle();
    expect(t.uploaded).toHaveLength(1);
    expect(t.queue.getSnapshot().items).toEqual([]);
  });

  it('si se cae la red durante el PUT queda esperando la señal y reintenta al volver', async () => {
    const t = setup();
    await t.queue.start(USER_ID);
    t.uploader.handler = (_request, call) => {
      if (call === 1) {
        t.network.online = false; // el sistema ya sabe que no hay red
        throw networkError(new Error('Network request failed'));
      }
      return makeDocument('CEDULA');
    };
    await t.queue.enqueue(photo);
    await t.queue.idle();

    expect(t.queue.getSnapshot().items[0]).toMatchObject({
      phase: 'waitingNetwork',
      lastErrorCode: 'NETWORK_ERROR',
    });
    expect(t.scheduler.pending).toEqual([]); // sin temporizadores mientras no haya red

    t.network.set(true);
    await t.queue.idle();
    expect(t.uploader.calls).toHaveLength(2);
    // La URL firmada aún vigente se reutiliza: no se pide otra.
    expect(t.api.calls).toHaveLength(1);
    expect(t.uploaded).toHaveLength(1);
  });

  it('con señal débil (hay red pero la petición falla) reintenta con backoff exponencial', async () => {
    const t = setup();
    await t.queue.start(USER_ID);
    t.uploader.handler = (_request, call) => {
      if (call <= 2) throw networkError();
      return makeDocument('CEDULA');
    };
    await t.queue.enqueue(photo);
    await t.queue.idle();

    expect(t.queue.getSnapshot().items[0]).toMatchObject({ phase: 'retryScheduled', attempts: 1 });
    expect(t.scheduler.pending).toEqual([2_000]);

    t.scheduler.advance(1_999);
    await t.queue.idle();
    expect(t.uploader.calls).toHaveLength(1);

    t.scheduler.advance(1);
    await t.queue.idle();
    expect(t.uploader.calls).toHaveLength(2);
    expect(t.scheduler.pending).toEqual([4_000]);

    t.scheduler.advance(4_000);
    await t.queue.idle();
    expect(t.uploader.calls).toHaveLength(3);
    expect(t.uploaded).toHaveLength(1);
  });

  it('al volver la señal reinicia el backoff y reintenta de inmediato', async () => {
    const t = setup();
    await t.queue.start(USER_ID);
    t.uploader.handler = (_r, call) => {
      if (call === 1) throw new ApiError(ApiErrorCode.INTERNAL_ERROR, 'boom', 500);
      return makeDocument('CEDULA');
    };
    await t.queue.enqueue(photo);
    await t.queue.idle();
    expect(t.queue.getSnapshot().items[0]?.phase).toBe('retryScheduled');

    t.network.set(false);
    expect(t.queue.getSnapshot().items[0]?.phase).toBe('waitingNetwork');
    t.network.set(true);
    await t.queue.idle();
    expect(t.uploaded).toHaveLength(1);
  });
});

describe('UploadQueue · URL firmada vencida', () => {
  it('ante UPLOAD_URL_INVALID pide otra URL de inmediato y repite el PUT con ella', async () => {
    const t = setup();
    await t.queue.start(USER_ID);
    t.uploader.handler = (_request, call) => {
      if (call === 1) throw new ApiError(ApiErrorCode.UPLOAD_URL_INVALID, 'vencida', 403);
      return makeDocument('CEDULA');
    };
    await t.queue.enqueue(photo);
    await t.queue.idle();

    expect(t.api.calls).toHaveLength(2);
    expect(t.uploader.calls.map((c) => c.url)).toEqual([
      'https://api.test/uploads/CEDULA?sig=1',
      'https://api.test/uploads/CEDULA?sig=2',
    ]);
    expect(t.uploaded).toHaveLength(1);
  });

  it('si la URL vuelve a fallar seguido, espera con backoff para no entrar en bucle', async () => {
    const t = setup();
    await t.queue.start(USER_ID);
    t.uploader.handler = (_r, call) => {
      if (call <= 2) throw new ApiError(ApiErrorCode.UPLOAD_URL_INVALID, 'vencida', 403);
      return makeDocument('CEDULA');
    };
    await t.queue.enqueue(photo);
    await t.queue.idle();
    expect(t.uploader.calls).toHaveLength(2);
    expect(t.queue.getSnapshot().items[0]).toMatchObject({ phase: 'retryScheduled', signed: null });

    t.scheduler.advance(backoffDelayMs(2, () => 0.5));
    await t.queue.idle();
    expect(t.api.calls).toHaveLength(3);
    expect(t.uploaded).toHaveLength(1);
  });

  it('pide una URL nueva antes del PUT si la guardada ya venció (p. ej. tras horas sin señal)', async () => {
    const t = setup();
    await t.queue.start(USER_ID);
    t.uploader.handler = (_r, call) => {
      if (call === 1) throw networkError();
      return makeDocument('CEDULA');
    };
    await t.queue.enqueue(photo);
    await t.queue.idle();
    // Pasan 20 minutos: la URL (10 min) venció.
    t.scheduler.advance(20 * 60_000);
    await t.queue.idle();

    expect(t.api.calls).toHaveLength(2);
    expect(t.uploader.calls[1]?.url).toBe('https://api.test/uploads/CEDULA?sig=2');
    expect(t.uploaded).toHaveLength(1);
  });
});

describe('UploadQueue · rechazos definitivos', () => {
  it.each([ApiErrorCode.DOCUMENT_TOO_LARGE, ApiErrorCode.DOCUMENT_TYPE_NOT_ALLOWED])(
    'queda en failed ante %s y no reintenta',
    async (code) => {
      const t = setup();
      await t.queue.start(USER_ID);
      t.uploader.handler = () => {
        throw new ApiError(code, 'rechazado', 413);
      };
      await t.queue.enqueue(photo);
      await t.queue.idle();
      t.scheduler.advance(10 * 60_000);
      await t.queue.idle();

      expect(t.uploader.calls).toHaveLength(1);
      expect(t.queue.getSnapshot().items[0]).toMatchObject({
        phase: 'failed',
        lastErrorCode: code,
      });
    },
  );

  it('también si la API rechaza el tamaño al pedir la URL', async () => {
    const t = setup();
    await t.queue.start(USER_ID);
    t.api.handler = () => {
      throw new ApiError(ApiErrorCode.VALIDATION_ERROR, 'sizeBytes', 400);
    };
    await t.queue.enqueue(photo);
    await t.queue.idle();
    expect(t.uploader.calls).toHaveLength(0);
    expect(t.queue.getSnapshot().items[0]?.phase).toBe('failed');
  });

  it('no encola una foto de más de DOCUMENT_MAX_BYTES ni un tipo no permitido', async () => {
    const t = setup();
    t.files.sourceSizes.set(photo.sourceUri, DOCUMENT_MAX_BYTES + 1);
    await t.queue.start(USER_ID);

    await expect(t.queue.enqueue(photo)).rejects.toMatchObject({
      code: ApiErrorCode.DOCUMENT_TOO_LARGE,
    });
    await expect(
      t.queue.enqueue({ ...photo, contentType: 'image/heic' as 'image/jpeg' }),
    ).rejects.toMatchObject({ code: ApiErrorCode.DOCUMENT_TYPE_NOT_ALLOWED });
    expect(t.queue.getSnapshot().items).toEqual([]);
    expect(t.files.files.size).toBe(0);
  });

  it('una foto nueva del mismo documento reemplaza a la rechazada', async () => {
    const t = setup();
    await t.queue.start(USER_ID);
    t.uploader.handler = (_r, call) => {
      if (call === 1) throw new ApiError(ApiErrorCode.DOCUMENT_TOO_LARGE, 'grande', 413);
      return makeDocument('CEDULA');
    };
    const first = await t.queue.enqueue(photo);
    await t.queue.idle();
    t.scheduler.current += 1;
    await t.queue.enqueue({ ...photo, sourceUri: 'file:///cache/cedula-2.jpg' });
    await t.queue.idle();

    expect(t.files.files.has(first.fileUri)).toBe(false);
    expect(t.uploaded).toHaveLength(1);
    expect(t.queue.getSnapshot().items).toEqual([]);
  });
});

describe('UploadQueue · nunca duplica', () => {
  it('mantiene una sola subida por documento', async () => {
    const t = setup({ online: false });
    await t.queue.start(USER_ID);
    await t.queue.enqueue(photo);
    t.scheduler.current += 1;
    await t.queue.enqueue({ ...photo, sourceUri: 'file:///cache/otra.jpg' });

    expect(t.queue.getSnapshot().items).toHaveLength(1);
    expect(t.files.files.size).toBe(1);
    t.network.set(true);
    await t.queue.idle();
    expect(t.uploader.calls).toHaveLength(1);
  });

  it('una foto nueva durante el PUT cancela el anterior; solo se registra la nueva', async () => {
    const t = setup();
    await t.queue.start(USER_ID);
    const firstPut = deferred<DriverDocument>();
    t.uploader.handler = (_r, call) =>
      call === 1 ? firstPut.promise : makeDocument('CEDULA', { sizeBytes: 123 });
    await t.queue.enqueue(photo);
    await tick();
    expect(t.uploader.calls).toHaveLength(1);

    t.scheduler.current += 1;
    await t.queue.enqueue({ ...photo, sourceUri: 'file:///cache/nueva.jpg' });
    expect(t.uploader.calls[0]?.signal.aborted).toBe(true);
    firstPut.resolve(makeDocument('CEDULA'));
    await t.queue.idle();

    expect(t.uploaded).toEqual([makeDocument('CEDULA', { sizeBytes: 123 })]);
    expect(t.queue.getSnapshot().items).toEqual([]);
  });

  it('volver la señal varias veces no lanza subidas paralelas del mismo documento', async () => {
    const t = setup({ online: false });
    await t.queue.start(USER_ID);
    await t.queue.enqueue(photo);
    t.network.set(true);
    t.network.set(false);
    t.network.set(true);
    t.queue.retryNow();
    await t.queue.idle();
    expect(t.uploader.calls).toHaveLength(1);
    expect(t.uploaded).toHaveLength(1);
  });
});

describe('UploadQueue · reinicio de la app', () => {
  it('reanuda lo pendiente con la misma foto y el metadato guardados', async () => {
    const store = new MemoryQueueStore();
    const files = new MemoryFiles();
    const before = setup({ store, files, online: false });
    await before.queue.start(USER_ID);
    const item = await before.queue.enqueue(photo);
    await before.queue.idle();
    before.queue.stop(); // la app se cierra

    const after = setup({ store, files });
    await after.queue.start(USER_ID);
    await after.queue.idle();
    expect(after.uploader.calls).toHaveLength(1);
    expect(after.uploader.calls[0]?.fileUri).toBe(item.fileUri);
    expect(after.uploaded).toHaveLength(1);
    expect(store.saved?.items).toEqual([]);
  });

  it('un PUT que quedó a medias al cerrar la app se repite una sola vez, con su URL vigente', async () => {
    const store = new MemoryQueueStore();
    const files = new MemoryFiles();
    const before = setup({ store, files });
    await before.queue.start(USER_ID);
    before.uploader.handler = () => new Promise<DriverDocument>(() => {}); // nunca responde
    await before.queue.enqueue(photo);
    await tick();
    await tick();
    // Quedó guardada en curso y con la URL firmada que se pidió.
    expect(store.saved?.items[0]).toMatchObject({
      signed: { url: signedUrl('CEDULA', 1).uploadUrl },
    });
    before.queue.stop();

    const after = setup({ store, files });
    await after.queue.start(USER_ID);
    await after.queue.idle();
    expect(after.api.calls).toHaveLength(0);
    expect(after.uploader.calls).toHaveLength(1);
    expect(after.uploaded).toHaveLength(1);
  });

  it('descarta la cola de otra cuenta y sus fotos', async () => {
    const store = new MemoryQueueStore();
    const files = new MemoryFiles();
    const before = setup({ store, files, online: false });
    await before.queue.start('otra-cuenta');
    await before.queue.enqueue(photo);
    await before.queue.idle();
    before.queue.stop();

    const after = setup({ store, files });
    await after.queue.start(USER_ID);
    await after.queue.idle();
    expect(after.uploader.calls).toHaveLength(0);
    expect(files.files.size).toBe(0);
    expect(store.saved).toEqual({ version: 1, userId: USER_ID, items: [] });
  });

  it('olvida las subidas cuya foto ya no existe en el teléfono', async () => {
    const store = new MemoryQueueStore();
    const files = new MemoryFiles();
    const before = setup({ store, files, online: false });
    await before.queue.start(USER_ID);
    const item = await before.queue.enqueue(photo);
    await before.queue.idle();
    before.queue.stop();
    files.files.delete(item.fileUri);

    const after = setup({ store, files });
    await after.queue.start(USER_ID);
    await after.queue.idle();
    expect(after.queue.getSnapshot().items).toEqual([]);
    expect(after.uploader.calls).toHaveLength(0);
  });
});

describe('upload-policy', () => {
  it('clasifica los errores', () => {
    expect(classifyUploadError('NETWORK_ERROR')).toBe('network');
    expect(classifyUploadError('UPLOAD_URL_INVALID')).toBe('urlExpired');
    expect(classifyUploadError('DOCUMENT_TOO_LARGE')).toBe('fatal');
    expect(classifyUploadError('DOCUMENT_TYPE_NOT_ALLOWED')).toBe('fatal');
    expect(classifyUploadError('INTERNAL_ERROR')).toBe('transient');
    expect(classifyUploadError('INVALID_RESPONSE')).toBe('transient');
  });

  it('backoff exponencial con tope y variación de ±20 %', () => {
    const exact = () => 0.5;
    expect([1, 2, 3, 4, 5, 6, 7, 10].map((n) => backoffDelayMs(n, exact))).toEqual([
      2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000,
    ]);
    expect(backoffDelayMs(1, () => 0)).toBe(BACKOFF_BASE_MS * 0.8);
    expect(backoffDelayMs(1, () => 1)).toBe(BACKOFF_BASE_MS * 1.2);
  });

  it('considera que hay red salvo que el sistema diga lo contrario', () => {
    expect(isOnlineState({ isConnected: true, isInternetReachable: true })).toBe(true);
    expect(isOnlineState({})).toBe(true);
    expect(isOnlineState({ isConnected: false })).toBe(false);
    expect(isOnlineState({ isConnected: true, isInternetReachable: false })).toBe(false);
  });
});
