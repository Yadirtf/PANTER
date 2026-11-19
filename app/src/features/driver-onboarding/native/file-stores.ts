// Persistencia de la cola de subida con expo-file-system: las fotos y el JSON de la cola viven en
// el directorio de documentos de la app (no lo limpia el sistema, a diferencia de la caché).
import { Directory, File, Paths } from 'expo-file-system';
import type { DocumentFileStore, PersistedQueue, UploadQueueStore } from '../upload/upload-types';

const UPLOADS_DIR = 'driver-document-uploads';
const QUEUE_FILE = 'queue.json';

function uploadsDirectory(): Directory {
  const directory = new Directory(Paths.document, UPLOADS_DIR);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function isPersistedQueue(value: unknown): value is PersistedQueue {
  if (typeof value !== 'object' || value === null) return false;
  const queue = value as Partial<PersistedQueue>;
  return queue.version === 1 && typeof queue.userId === 'string' && Array.isArray(queue.items);
}

export const fileQueueStore: UploadQueueStore = {
  async load() {
    const file = new File(uploadsDirectory(), QUEUE_FILE);
    if (!file.exists) return null;
    try {
      const value: unknown = JSON.parse(await file.text());
      return isPersistedQueue(value) ? value : null;
    } catch {
      return null;
    }
  },
  async save(queue) {
    const directory = uploadsDirectory();
    const file = new File(directory, QUEUE_FILE);
    // Se escribe a un temporal y se mueve: un cierre a mitad de escritura no corrompe la cola.
    const temp = new File(directory, `${QUEUE_FILE}.tmp`);
    if (temp.exists) temp.delete();
    temp.create();
    temp.writeSync(JSON.stringify(queue));
    if (file.exists) file.delete();
    temp.moveSync(file);
  },
};

export const documentFileStore: DocumentFileStore = {
  async persist(sourceUri, name) {
    const target = new File(uploadsDirectory(), name);
    if (target.exists) target.delete();
    await new File(sourceUri).copy(target);
    return { uri: target.uri, sizeBytes: target.size };
  },
  async remove(uri) {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
  async exists(uri) {
    return new File(uri).exists;
  },
};
