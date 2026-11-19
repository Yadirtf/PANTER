// Puertos y estado de la descarga del mapa para usar sin señal (HU-303, §6.1).

/** Copia completa y verificada del mapa en el teléfono. */
export interface OfflineCopy {
  file: string;
  build: string;
  size: number;
  sha256: string;
  assetsCommit: string;
  completedAt: string;
}

/** Descarga empezada (el .part crece con cada bloque; su tamaño es el punto de reanudación). */
export interface PendingDownload {
  file: string;
  build: string;
  size: number;
  sha256: string;
  assetsCommit: string;
}

/** Lo que se guarda en offline-map.json. */
export interface OfflineMapRecord {
  version: 1;
  current: OfflineCopy | null;
  pending: PendingDownload | null;
  /** Commit de basemaps-assets de los glifos y sprites guardados. */
  assetsCommit: string | null;
}

/** Almacenamiento de la copia (expo-file-system en la app; memoria en las pruebas). */
export interface OfflineMapStorage {
  loadRecord(): Promise<OfflineMapRecord | null>;
  saveRecord(record: OfflineMapRecord): Promise<void>;
  /** Bytes ya escritos en `<file>.part` (0 si no existe). */
  partialSize(file: string): number;
  /** Agrega `bytes` al final de `<file>.part`; `offset` debe ser su tamaño actual. */
  appendPartial(file: string, offset: number, bytes: Uint8Array): Promise<void>;
  deletePartial(file: string): void;
  /** Renombra `<file>.part` a `<file>`. */
  completePartial(file: string): void;
  /** SHA-256 en hexadecimal (minúsculas) de `<file>`. */
  digest(file: string): Promise<string>;
  deleteBasemap(file: string): void;
  writeAsset(path: string, bytes: Uint8Array): Promise<void>;
  deleteAssets(): void;
  /** Espacio libre del almacenamiento interno, en bytes. */
  availableBytes(): number;
  /** URI `file://` de la carpeta de la copia. */
  rootUri(): string;
}

export type FetchFailureKind = 'network' | 'server' | 'mismatch';

/** Fallo de una descarga: sin red (se reanuda sola), del servidor o datos inesperados. */
export class OfflineFetchError extends Error {
  constructor(
    readonly kind: FetchFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'OfflineFetchError';
  }
}

/** Tamaño total en un Content-Range de 206: "bytes 0-2097151/48211337" → 48211337. */
export function totalFromContentRange(header: string | null): number | null {
  const match = header ? /^bytes \d+-\d+\/(\d+)$/.exec(header.trim()) : null;
  return match?.[1] ? Number(match[1]) : null;
}

export interface RangeChunk {
  bytes: Uint8Array;
  /** Tamaño total del archivo según Content-Range. */
  total: number;
}

export interface OfflineMapNetwork {
  /** GET con `Range: bytes=offset-(offset+length-1)`; exige 206. Lanza OfflineFetchError. */
  fetchRange(url: string, offset: number, length: number, signal: AbortSignal): Promise<RangeChunk>;
  /** GET de un archivo pequeño completo. Lanza OfflineFetchError. */
  fetchBytes(url: string, signal: AbortSignal): Promise<Uint8Array>;
  isOnline(): Promise<boolean>;
  subscribe(listener: (online: boolean) => void): () => void;
}

export type DownloadPhase = 'tiles' | 'assets' | 'verifying';

export type DownloadState =
  | { status: 'idle' }
  | {
      status: 'downloading';
      build: string;
      phase: DownloadPhase;
      receivedBytes: number;
      totalBytes: number;
    }
  /** Cortada (sin señal o pausada): se reanuda desde `receivedBytes`. */
  | {
      status: 'interrupted';
      build: string;
      receivedBytes: number;
      totalBytes: number;
      reason: 'network' | 'paused' | 'server';
      message: string;
    }
  | { status: 'no-space'; build: string; requiredBytes: number; availableBytes: number }
  | { status: 'failed'; build: string; message: string };

export interface OfflineMapSnapshot {
  loaded: boolean;
  current: OfflineCopy | null;
  /** Último manifiesto publicado que conoce la app. */
  latest: { file: string; build: string; size: number } | null;
  /** Hay copia local y el manifiesto publicado es de otro build. */
  updateAvailable: boolean;
  download: DownloadState;
}
