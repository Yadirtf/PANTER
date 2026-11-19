// Cola persistente de subida de documentos (HU-203, "reintento sin red").
//
// - Cada foto se copia al almacenamiento de la app y la cola (con su metadato) se guarda en un
//   archivo JSON: sobrevive a cerrar o reiniciar la app.
// - Hay como máximo una subida por tipo de documento: tomar otra foto reemplaza la anterior y
//   cancela su PUT si estaba en curso. Las subidas van de a una. La API guarda un documento por
//   (usuario, tipo), así que un PUT repetido tras un reinicio reemplaza, nunca duplica.
// - Sin red, las subidas esperan y se reanudan solas al volver la conexión; los fallos pasajeros
//   se reintentan con backoff exponencial; una URL firmada vencida (UPLOAD_URL_INVALID) se pide de
//   nuevo automáticamente; los rechazos definitivos (tamaño, tipo) quedan en `failed`.
//
// TypeScript puro: los puertos (archivos, red, API, reloj) se inyectan y se prueban en Node.
import {
  ApiErrorCode,
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  type DocumentType,
  type DriverDocument,
} from '@panter/contracts';
import { ApiError, toApiError } from '../../../shared/api/errors';
import { backoffDelayMs, classifyUploadError, URL_EXPIRY_MARGIN_MS } from './upload-policy';
import {
  type DocumentContentType,
  type DocumentFileStore,
  type DocumentUploader,
  type NetworkMonitor,
  type PersistedQueue,
  type Scheduler,
  systemScheduler,
  type UploadItem,
  type UploadQueueStore,
  type UploadUrlRequester,
} from './upload-types';

export interface UploadQueueDeps {
  store: UploadQueueStore;
  files: DocumentFileStore;
  api: UploadUrlRequester;
  uploader: DocumentUploader;
  network: NetworkMonitor;
  scheduler?: Scheduler;
  random?: () => number;
}

export interface UploadQueueSnapshot {
  readonly online: boolean;
  readonly items: readonly UploadItem[];
}

export interface EnqueueInput {
  readonly type: DocumentType;
  /** URI de la foto ya comprimida (archivo temporal). */
  readonly sourceUri: string;
  readonly contentType: DocumentContentType;
}

const EXTENSIONS: Record<DocumentContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Fases que solo existen mientras corre el proceso: al reiniciar la app vuelven a la cola. */
const IN_FLIGHT = new Set<UploadItem['phase']>(['requestingUrl', 'uploading']);

type Listener = () => void;
type UploadedListener = (document: DriverDocument) => void;

export function isAllowedContentType(value: string): value is DocumentContentType {
  return (DOCUMENT_CONTENT_TYPES as readonly string[]).includes(value);
}

export class UploadQueue {
  private readonly deps: UploadQueueDeps;
  private readonly scheduler: Scheduler;
  private readonly random: () => number;

  private userId: string | null = null;
  /** Cambia con cada start/stop: descarta trabajo de una sesión anterior. */
  private epoch = 0;
  private items: UploadItem[] = [];
  private online = true;
  private snapshot: UploadQueueSnapshot = { online: true, items: [] };

  private starting: Promise<void> | null = null;
  private loop: Promise<void> | null = null;
  private rerun = false;
  private timer: unknown = null;
  private inFlight: { id: string; controller: AbortController } | null = null;
  private saving: Promise<void> = Promise.resolve();
  private unsubscribeNetwork: (() => void) | null = null;

  private readonly listeners = new Set<Listener>();
  private readonly uploadedListeners = new Set<UploadedListener>();

  constructor(deps: UploadQueueDeps) {
    this.deps = deps;
    this.scheduler = deps.scheduler ?? systemScheduler;
    this.random = deps.random ?? Math.random;
  }

  // --- Suscripción (useSyncExternalStore) ---

  getSnapshot = (): UploadQueueSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Avisa cada documento que la API aceptó (respuesta del PUT). */
  onUploaded(listener: UploadedListener): () => void {
    this.uploadedListeners.add(listener);
    return () => this.uploadedListeners.delete(listener);
  }

  getItem(type: DocumentType): UploadItem | undefined {
    return this.items.find((item) => item.type === type);
  }

  // --- Ciclo de vida ---

  /**
   * Carga la cola guardada del usuario y empieza a procesarla. Idempotente para el mismo
   * usuario. Si la cola guardada es de otra cuenta, se descarta con sus archivos.
   */
  start(userId: string): Promise<void> {
    if (this.userId === userId && this.starting) return this.starting;
    this.stop();
    this.userId = userId;
    const epoch = this.epoch;
    this.starting = this.restore(userId, epoch);
    return this.starting;
  }

  /** Deja de procesar (cierre de sesión). Lo guardado sigue en disco para la próxima vez. */
  stop(): void {
    this.epoch += 1;
    this.userId = null;
    this.starting = null;
    this.clearTimer();
    this.inFlight?.controller.abort();
    this.inFlight = null;
    // El bucle anterior termina solo al ver el epoch nuevo; el siguiente start arranca otro.
    this.loop = null;
    this.rerun = false;
    this.unsubscribeNetwork?.();
    this.unsubscribeNetwork = null;
    this.items = [];
    this.emit();
  }

  private async restore(userId: string, epoch: number): Promise<void> {
    const { store, files, network } = this.deps;
    const persisted = await store.load().catch(() => null);
    const online = await network.isOnline().catch(() => true);
    if (epoch !== this.epoch) return;

    let restored: UploadItem[] = [];
    if (persisted?.userId === userId) {
      for (const item of persisted.items) {
        const exists = await files.exists(item.fileUri).catch(() => false);
        if (exists) restored.push(item);
      }
    } else if (persisted) {
      await Promise.all(persisted.items.map((item) => files.remove(item.fileUri).catch(() => {})));
    }
    if (epoch !== this.epoch) return;

    restored = restored.map((item) => {
      const phase = IN_FLIGHT.has(item.phase) ? 'queued' : item.phase;
      return { ...item, phase, progress: 0 };
    });
    this.online = online;
    this.items = restored.map((item) => this.withNetworkPhase(item, online, true));
    this.unsubscribeNetwork = network.subscribe((value) => this.handleNetwork(epoch, value));
    this.emit();
    this.persist();
    this.kick();
  }

  // --- Operaciones ---

  /**
   * Agrega la foto de un documento. Reemplaza la subida pendiente del mismo tipo (y cancela su PUT
   * si estaba en curso). Lanza DOCUMENT_TOO_LARGE o DOCUMENT_TYPE_NOT_ALLOWED sin encolar.
   */
  async enqueue(input: EnqueueInput): Promise<UploadItem> {
    if (!isAllowedContentType(input.contentType)) {
      throw new ApiError(ApiErrorCode.DOCUMENT_TYPE_NOT_ALLOWED, 'Tipo de archivo no permitido');
    }
    if (!this.starting || !this.userId) {
      throw new ApiError(ApiErrorCode.UNAUTHENTICATED, 'No hay sesión activa', 401);
    }
    await this.starting;
    const epoch = this.epoch;
    const createdAt = this.scheduler.now();
    const id = `${input.type}-${createdAt}`;
    const name = `${id}.${EXTENSIONS[input.contentType]}`;
    const file = await this.deps.files.persist(input.sourceUri, name);
    if (epoch !== this.epoch) {
      await this.deps.files.remove(file.uri).catch(() => {});
      throw new ApiError(ApiErrorCode.UNAUTHENTICATED, 'La sesión cambió', 401);
    }
    if (file.sizeBytes > DOCUMENT_MAX_BYTES) {
      await this.deps.files.remove(file.uri).catch(() => {});
      throw new ApiError(ApiErrorCode.DOCUMENT_TOO_LARGE, 'La foto supera el tamaño máximo', 413);
    }

    const previous = this.getItem(input.type);
    if (previous) await this.drop(previous);

    const item: UploadItem = this.withNetworkPhase(
      {
        id,
        type: input.type,
        fileUri: file.uri,
        contentType: input.contentType,
        sizeBytes: file.sizeBytes,
        createdAt,
        attempts: 0,
        phase: 'queued',
        progress: 0,
        signed: null,
        nextAttemptAt: null,
        lastErrorCode: null,
      },
      this.online,
    );
    this.items = [...this.items, item];
    this.emit();
    this.persist();
    this.kick();
    return item;
  }

  /** Quita la subida pendiente de un tipo (p. ej. tras un rechazo definitivo). */
  async discard(type: DocumentType): Promise<void> {
    const item = this.getItem(type);
    if (!item) return;
    await this.drop(item);
    this.emit();
    this.persist();
    this.kick();
  }

  /** "Reintentar ahora": salta el backoff de las subidas en espera. */
  retryNow(type?: DocumentType): void {
    if (!this.online) return;
    this.items = this.items.map((item) =>
      (type === undefined || item.type === type) &&
      (item.phase === 'retryScheduled' || item.phase === 'waitingNetwork')
        ? { ...item, phase: 'queued', nextAttemptAt: null }
        : item,
    );
    this.emit();
    this.persist();
    this.kick();
  }

  /** Se resuelve cuando no queda trabajo en curso (útil en pruebas y al cerrar). */
  async idle(): Promise<void> {
    for (;;) {
      const pending = [this.starting, this.loop, this.saving];
      await Promise.all(pending.map((p) => p?.catch(() => {})));
      if (this.loop === null && pending[2] === this.saving && pending[0] === this.starting) return;
    }
  }

  // --- Procesamiento ---

  private kick(): void {
    if (!this.userId) return;
    if (this.loop) {
      this.rerun = true;
      return;
    }
    const epoch = this.epoch;
    const loop = this.runLoop(epoch).finally(() => {
      if (this.loop === loop) this.loop = null;
      if (this.rerun && epoch === this.epoch) {
        this.rerun = false;
        this.kick();
      }
    });
    this.loop = loop;
  }

  private async runLoop(epoch: number): Promise<void> {
    while (epoch === this.epoch) {
      this.rerun = false;
      this.clearTimer();
      const next = this.nextEligible();
      if (!next) {
        this.scheduleWake();
        return;
      }
      await this.process(next, epoch);
    }
  }

  private nextEligible(): UploadItem | undefined {
    if (!this.online) return undefined;
    const now = this.scheduler.now();
    return [...this.items]
      .sort((a, b) => a.createdAt - b.createdAt)
      .find(
        (item) =>
          item.phase === 'queued' ||
          (item.phase === 'retryScheduled' && (item.nextAttemptAt ?? 0) <= now),
      );
  }

  private scheduleWake(): void {
    if (!this.online) return;
    const times = this.items
      .filter((item) => item.phase === 'retryScheduled' && item.nextAttemptAt !== null)
      .map((item) => item.nextAttemptAt as number);
    if (times.length === 0) return;
    const delay = Math.max(0, Math.min(...times) - this.scheduler.now());
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      this.kick();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private isCurrent(id: string, epoch: number): boolean {
    return epoch === this.epoch && this.items.some((item) => item.id === id);
  }

  private async process(item: UploadItem, epoch: number): Promise<void> {
    const controller = new AbortController();
    this.inFlight = { id: item.id, controller };
    try {
      let signed = item.signed;
      if (!signed || signed.expiresAt - URL_EXPIRY_MARGIN_MS <= this.scheduler.now()) {
        this.update(item.id, { phase: 'requestingUrl', progress: 0 });
        const response = await this.deps.api.requestUploadUrl(item.type, {
          contentType: item.contentType,
          sizeBytes: item.sizeBytes,
        });
        if (!this.isCurrent(item.id, epoch)) return;
        if (item.sizeBytes > response.maxBytes) {
          throw new ApiError(ApiErrorCode.DOCUMENT_TOO_LARGE, 'La foto supera el máximo', 413);
        }
        signed = {
          url: response.uploadUrl,
          contentType: response.headers['content-type'],
          maxBytes: response.maxBytes,
          expiresAt: Date.parse(response.expiresAt),
        };
        this.update(item.id, { signed });
        this.persist();
      }

      this.update(item.id, { phase: 'uploading', progress: 0 });
      const document = await this.deps.uploader.put({
        url: signed.url,
        fileUri: item.fileUri,
        headers: { 'content-type': signed.contentType },
        signal: controller.signal,
        onProgress: (fraction) => {
          if (!this.isCurrent(item.id, epoch)) return;
          this.update(item.id, { progress: Math.min(1, Math.max(0, fraction)) });
        },
      });
      // Se reemplazó o descartó durante el PUT: manda la versión nueva.
      if (!this.isCurrent(item.id, epoch)) return;
      this.items = this.items.filter((entry) => entry.id !== item.id);
      this.emit();
      this.persist();
      await this.deps.files.remove(item.fileUri).catch(() => {});
      for (const listener of this.uploadedListeners) listener(document);
    } catch (error) {
      if (!this.isCurrent(item.id, epoch)) return;
      await this.handleFailure(item.id, toApiError(error), epoch);
    } finally {
      if (this.inFlight?.id === item.id) this.inFlight = null;
    }
  }

  private async handleFailure(id: string, error: ApiError, epoch: number): Promise<void> {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return;
    const kind = classifyUploadError(error.code);
    const attempts = item.attempts + 1;
    const now = this.scheduler.now();
    const backoff = {
      phase: 'retryScheduled',
      attempts,
      nextAttemptAt: now + backoffDelayMs(attempts, this.random),
      lastErrorCode: error.code,
      progress: 0,
    } as const;

    switch (kind) {
      case 'urlExpired': {
        // Primera vez: se pide otra URL de inmediato. Si se repite, con backoff.
        const repeated = item.lastErrorCode === ApiErrorCode.UPLOAD_URL_INVALID;
        this.update(
          id,
          repeated
            ? { ...backoff, signed: null }
            : {
                phase: 'queued',
                attempts,
                signed: null,
                nextAttemptAt: null,
                lastErrorCode: error.code,
                progress: 0,
              },
        );
        break;
      }
      case 'network': {
        const online = await this.deps.network.isOnline().catch(() => false);
        if (!this.isCurrent(id, epoch)) return;
        if (!online) {
          this.online = false;
          this.items = this.items.map((entry) => this.withNetworkPhase(entry, false));
          this.update(id, {
            phase: 'waitingNetwork',
            nextAttemptAt: null,
            lastErrorCode: error.code,
            progress: 0,
          });
        } else {
          // Hay red pero la petición no llegó (señal débil): backoff.
          this.update(id, backoff);
        }
        break;
      }
      case 'fatal':
        this.update(id, {
          phase: 'failed',
          attempts,
          signed: null,
          nextAttemptAt: null,
          lastErrorCode: error.code,
          progress: 0,
        });
        break;
      case 'transient':
        this.update(id, backoff);
        break;
    }
    this.persist();
  }

  private handleNetwork(epoch: number, online: boolean): void {
    if (epoch !== this.epoch || online === this.online) return;
    this.online = online;
    if (online) {
      // Volvió la señal: todo lo que esperaba se intenta ya, con el backoff reiniciado.
      this.items = this.items.map((item) =>
        item.phase === 'waitingNetwork' || item.phase === 'retryScheduled'
          ? { ...item, phase: 'queued', attempts: 0, nextAttemptAt: null }
          : item,
      );
    } else {
      this.clearTimer();
      this.items = this.items.map((item) => this.withNetworkPhase(item, false));
    }
    this.emit();
    this.persist();
    if (online) this.kick();
  }

  /** Ajusta la fase de un elemento en espera al estado de la red. */
  private withNetworkPhase(item: UploadItem, online: boolean, restoring = false): UploadItem {
    if (!online && (item.phase === 'queued' || item.phase === 'retryScheduled')) {
      return { ...item, phase: 'waitingNetwork', nextAttemptAt: null };
    }
    if (online && restoring && item.phase === 'waitingNetwork') {
      return { ...item, phase: 'queued', nextAttemptAt: null };
    }
    return item;
  }

  private async drop(item: UploadItem): Promise<void> {
    if (this.inFlight?.id === item.id) this.inFlight.controller.abort();
    this.items = this.items.filter((entry) => entry.id !== item.id);
    await this.deps.files.remove(item.fileUri).catch(() => {});
  }

  private update(id: string, patch: Partial<UploadItem>): void {
    this.items = this.items.map((item) => (item.id === id ? { ...item, ...patch } : item));
    this.emit();
  }

  private emit(): void {
    this.snapshot = { online: this.online, items: this.items };
    for (const listener of this.listeners) listener();
  }

  /** Guarda la cola en orden (las escrituras no se pisan). Un fallo de disco no detiene la cola. */
  private persist(): void {
    if (!this.userId) return;
    const queue: PersistedQueue = {
      version: 1,
      userId: this.userId,
      items: this.items.map((item) => ({ ...item, progress: 0 })),
    };
    this.saving = this.saving.then(() => this.deps.store.save(queue)).catch(() => {});
  }
}
