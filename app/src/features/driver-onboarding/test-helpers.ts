// Dobles de prueba del onboarding: perfil de conductor que cumple el contrato y puertos en memoria
// de la cola de subida (disco, red, reloj, API y PUT).
import {
  type DocumentType,
  type DocumentUploadUrlResponse,
  type DriverDocument,
  type DriverProfile,
  REQUIRED_DOCUMENTS,
} from '@panter/contracts';
import { makeUser } from '../../test/fake-api';
import type {
  DocumentFileStore,
  DocumentUploader,
  NetworkMonitor,
  PersistedQueue,
  PutRequest,
  Scheduler,
  UploadQueueStore,
  UploadUrlRequester,
} from './upload/upload-types';

export const USER_ID = makeUser().id;
export const NOW = Date.parse('2026-11-18T15:00:00.000Z');

export function makeDocument(
  type: DocumentType,
  overrides: Partial<DriverDocument> = {},
): DriverDocument {
  return {
    type,
    status: 'SUBMITTED',
    contentType: 'image/jpeg',
    sizeBytes: 350_000,
    uploadedAt: '2026-11-18T14:00:00.000Z',
    reviewedAt: null,
    rejectionReason: null,
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<DriverProfile> = {}): DriverProfile {
  const documents = overrides.documents ?? [];
  return {
    userId: USER_ID,
    vehicle: {
      vehicleType: 'MOTOTAXI',
      plate: 'ABC12D',
      brand: 'Bajaj',
      model: 'RE 4S',
      color: 'Verde',
      year: 2022,
    },
    verificationStatus: 'PENDING',
    availability: 'OFFLINE',
    rejectionReason: null,
    appliedAt: '2026-11-18T13:00:00.000Z',
    reviewedAt: null,
    documents,
    missingDocuments: REQUIRED_DOCUMENTS.filter(
      (type) => !documents.some((d) => d.type === type && d.status !== 'REJECTED'),
    ),
    ...overrides,
  };
}

/** Reloj manual: `advance` ejecuta los temporizadores vencidos. */
export class FakeScheduler implements Scheduler {
  current = NOW;
  private timers = new Map<number, { at: number; callback: () => void }>();
  private nextId = 1;

  now = () => this.current;

  setTimeout = (callback: () => void, ms: number) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.current + ms, callback });
    return id;
  };

  clearTimeout = (handle: unknown) => {
    this.timers.delete(handle as number);
  };

  get pending(): number[] {
    return [...this.timers.values()].map((timer) => timer.at - this.current);
  }

  advance(ms: number): void {
    this.current += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at <= this.current) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }
}

export class MemoryQueueStore implements UploadQueueStore {
  saved: PersistedQueue | null = null;
  saves = 0;
  async load() {
    return this.saved ? (JSON.parse(JSON.stringify(this.saved)) as PersistedQueue) : null;
  }
  async save(queue: PersistedQueue) {
    this.saves += 1;
    this.saved = JSON.parse(JSON.stringify(queue)) as PersistedQueue;
  }
}

export class MemoryFiles implements DocumentFileStore {
  readonly files = new Map<string, number>();
  /** Tamaño de las fotos de origen (por defecto 400 KB). */
  readonly sourceSizes = new Map<string, number>();
  async persist(sourceUri: string, name: string) {
    const uri = `file:///docs/driver-document-uploads/${name}`;
    const size = this.sourceSizes.get(sourceUri) ?? 400_000;
    this.files.set(uri, size);
    return { uri, sizeBytes: size };
  }
  async remove(uri: string) {
    this.files.delete(uri);
  }
  async exists(uri: string) {
    return this.files.has(uri);
  }
}

export class FakeNetwork implements NetworkMonitor {
  online = true;
  private listeners = new Set<(online: boolean) => void>();
  async isOnline() {
    return this.online;
  }
  subscribe(listener: (online: boolean) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(online: boolean) {
    this.online = online;
    for (const listener of this.listeners) listener(online);
  }
}

type UrlHandler = (
  type: DocumentType,
  call: number,
) => DocumentUploadUrlResponse | Promise<DocumentUploadUrlResponse>;

export function signedUrl(
  type: DocumentType,
  n: number,
  expiresAt = '2026-11-18T15:10:00.000Z',
): DocumentUploadUrlResponse {
  return {
    uploadUrl: `https://api.test/uploads/${type}?sig=${n}`,
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    maxBytes: 8 * 1024 * 1024,
    expiresAt,
  };
}

export class FakeUrlApi implements UploadUrlRequester {
  calls: { type: DocumentType; body: unknown }[] = [];
  handler: UrlHandler = (type, call) => signedUrl(type, call);
  async requestUploadUrl(type: DocumentType, body: unknown) {
    this.calls.push({ type, body });
    return this.handler(type, this.calls.length);
  }
}

type PutHandler = (request: PutRequest, call: number) => DriverDocument | Promise<DriverDocument>;

export class FakeUploader implements DocumentUploader {
  calls: PutRequest[] = [];
  handler: PutHandler = (request) => {
    request.onProgress(0.5);
    request.onProgress(1);
    const type = /uploads\/([A-Z_]+)/.exec(request.url)?.[1] as DocumentType;
    return makeDocument(type);
  };
  async put(request: PutRequest) {
    this.calls.push(request);
    return this.handler(request, this.calls.length);
  }
}
