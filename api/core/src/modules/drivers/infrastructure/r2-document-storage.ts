import type { DocumentStorage } from '../application/ports';

/**
 * Documentos en el bucket R2 privado (binding DOCUMENTS). El bucket no tiene acceso público ni
 * dominio: solo este Worker lo lee y lo escribe. Cada objeto lleva su Content-Type y, como
 * metadatos propios, el dueño y el tipo de documento (auditoría).
 */
export function createR2DocumentStorage(bucket: R2Bucket): DocumentStorage {
  return {
    async put(key, bytes, meta) {
      await bucket.put(key, bytes, {
        httpMetadata: { contentType: meta.contentType },
        customMetadata: { userId: meta.userId, type: meta.type },
      });
    },
    async delete(key) {
      await bucket.delete(key);
    },
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return {
        body: object.body,
        contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
        size: object.size,
      };
    },
  };
}
