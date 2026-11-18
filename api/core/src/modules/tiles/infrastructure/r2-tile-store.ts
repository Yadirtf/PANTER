import type { TileObjectInfo, TileStore } from '../application/ports';

/** Adaptador del bucket R2 público del mapa base (binding TILES). */
export function createR2TileStore(bucket: R2Bucket): TileStore {
  return {
    async head(key) {
      const object = await bucket.head(key);
      return object ? toInfo(object) : null;
    },
    async read(key, info, range) {
      const whole = range.offset === 0 && range.length === info.size;
      // onlyIf: si el objeto cambió entre `head` y `get` (p. ej. al regenerar basemap.json), R2
      // devuelve el objeto sin cuerpo y no se mezclan bytes de dos versiones.
      const object = await bucket.get(key, {
        onlyIf: { etagMatches: info.etag.replace(/^"|"$/g, '') },
        ...(whole ? {} : { range }),
      });
      if (!object || !('body' in object)) return null;
      return object.body;
    },
  };
}

function toInfo(object: R2Object): TileObjectInfo {
  return { size: object.size, etag: object.httpEtag };
}
