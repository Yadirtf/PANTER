import type { UploadUseLedger } from '../application/ports';

/** Prefijo de las marcas de URLs de subida usadas en KV. */
export const UPLOAD_USED_PREFIX = 'drivers:upload-used:';

/** KV exige un TTL mínimo de 60 s. */
const MIN_TTL_SECONDS = 60;

/**
 * Registro de un solo uso en KV: la clave R2 de la URL (lleva un uuid nuevo por URL) se marca
 * hasta que la URL vence. KV es eventualmente consistente: dos PUT casi simultáneos desde
 * lugares distintos podrían pasar; ambos escriben la misma clave R2, así que no se duplica nada.
 */
export function createKvUploadLedger(kv: KVNamespace): UploadUseLedger {
  return {
    async isUsed(key) {
      return (await kv.get(UPLOAD_USED_PREFIX + key)) !== null;
    },
    async markUsed(key, ttlSeconds) {
      await kv.put(UPLOAD_USED_PREFIX + key, '1', {
        expirationTtl: Math.max(MIN_TTL_SECONDS, Math.ceil(ttlSeconds)),
      });
    },
  };
}
