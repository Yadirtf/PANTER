import type { ByteRange } from '../domain/http-range';

/** Metadatos de un objeto del mapa base. */
export interface TileObjectInfo {
  size: number;
  /** ETag HTTP entre comillas, tal como lo da R2 (`httpEtag`). */
  etag: string;
}

/** Almacén de los archivos del mapa base (bucket R2 TILES, con o sin la Cache API delante). */
export interface TileStore {
  head(key: string): Promise<TileObjectInfo | null>;
  /**
   * Lee `range` del objeto. `info` es el resultado de `head` (el adaptador con caché usa el ETag
   * en la clave para no mezclar versiones). Devuelve `null` si el objeto ya no existe.
   */
  read(key: string, info: TileObjectInfo, range: ByteRange): Promise<ReadableStream | null>;
}
