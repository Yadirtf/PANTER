// Datos y dobles de prueba del mapa: manifiesto, almacenamiento en memoria y red simulada.
import type { BasemapManifest } from '@panter/map-style';
import {
  OfflineFetchError,
  type OfflineMapNetwork,
  type OfflineMapRecord,
  type OfflineMapStorage,
} from './offline/offline-types';

export const API_URL = 'https://api.test';

export function makeManifest(overrides: Partial<BasemapManifest> = {}): BasemapManifest {
  return {
    file: 'panter-20261118.pmtiles',
    build: '20261118',
    bounds: [-77.05, 0.4, -76.3, 1.3],
    maxzoom: 15,
    size: 10,
    sha256: 'a'.repeat(64),
    generatedAt: '2026-11-18T12:00:00Z',
    pmtilesVersion: '1.28.0',
    assetsCommit: 'abc1234',
    ...overrides,
  };
}

/** SHA-256 en hexadecimal con Web Crypto (global en Node 20+). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Contenido determinista de un .pmtiles de `size` bytes, y su manifiesto con el SHA-256 real. */
export async function makeBasemap(size: number, build = '20261118', assetsCommit = 'abc1234') {
  const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 7 + build.length) % 256);
  const manifest = makeManifest({
    file: `panter-${build}.pmtiles`,
    build,
    size,
    sha256: await sha256Hex(bytes),
    assetsCommit,
  });
  return { bytes, manifest };
}

export class MemoryOfflineStorage implements OfflineMapStorage {
  record: OfflineMapRecord | null = null;
  readonly files = new Map<string, Uint8Array>();
  readonly assets = new Map<string, Uint8Array>();
  available = 1024 * 1024 * 1024;

  async loadRecord() {
    return this.record ? structuredClone(this.record) : null;
  }
  async saveRecord(record: OfflineMapRecord) {
    this.record = structuredClone(record);
  }
  partialSize(file: string) {
    return this.files.get(`${file}.part`)?.length ?? 0;
  }
  async appendPartial(file: string, offset: number, bytes: Uint8Array) {
    const key = `${file}.part`;
    const prev = this.files.get(key) ?? new Uint8Array(0);
    if (prev.length !== offset) throw new Error('offset inválido');
    const next = new Uint8Array(prev.length + bytes.length);
    next.set(prev);
    next.set(bytes, prev.length);
    this.files.set(key, next);
    this.available -= bytes.length;
  }
  deletePartial(file: string) {
    this.files.delete(`${file}.part`);
  }
  completePartial(file: string) {
    const part = this.files.get(`${file}.part`);
    if (!part) throw new Error('sin .part');
    this.files.delete(`${file}.part`);
    this.files.set(file, part);
  }
  async digest(file: string) {
    const bytes = this.files.get(file);
    if (!bytes) throw new Error('sin archivo');
    return sha256Hex(bytes);
  }
  deleteBasemap(file: string) {
    this.files.delete(file);
  }
  async writeAsset(path: string, bytes: Uint8Array) {
    this.assets.set(path, bytes);
  }
  deleteAssets() {
    this.assets.clear();
  }
  availableBytes() {
    return this.available;
  }
  rootUri() {
    return 'file:///data/user/0/co.panter.app/files/offline-map/';
  }
}

/** Red simulada: sirve los archivos publicados por rangos y se puede "cortar". */
export class FakeOfflineNetwork implements OfflineMapNetwork {
  readonly published = new Map<string, Uint8Array>();
  online = true;
  /** Corta la señal después de servir este número de bloques más. */
  cutAfterChunks: number | null = null;
  rangeRequests: { url: string; offset: number; length: number }[] = [];
  private listeners = new Set<(online: boolean) => void>();

  publish(file: string, bytes: Uint8Array) {
    this.published.set(`${API_URL}/tiles/${file}`, bytes);
  }

  setOnline(online: boolean) {
    this.online = online;
    for (const listener of this.listeners) listener(online);
  }

  async fetchRange(url: string, offset: number, length: number) {
    this.rangeRequests.push({ url, offset, length });
    if (!this.online) throw new OfflineFetchError('network', 'sin red');
    if (this.cutAfterChunks !== null) {
      if (this.cutAfterChunks === 0) {
        this.cutAfterChunks = null;
        this.online = false;
        throw new OfflineFetchError('network', 'se cortó la señal');
      }
      this.cutAfterChunks--;
    }
    const file = this.published.get(url);
    if (!file) throw new OfflineFetchError('mismatch', '404');
    return { bytes: file.slice(offset, offset + length), total: file.length };
  }

  async fetchBytes(url: string) {
    if (!this.online) throw new OfflineFetchError('network', 'sin red');
    return new TextEncoder().encode(url);
  }

  async isOnline() {
    return this.online;
  }

  subscribe(listener: (online: boolean) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
