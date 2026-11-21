// Copia del catálogo en el teléfono: un JSON por clave en <documentos>/catalog/.
import { Directory, File, Paths } from 'expo-file-system';
import type { CatalogStorage } from '../catalog-repository';

function catalogFile(key: string): File {
  const directory = new Directory(Paths.document, 'catalog');
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return new File(directory, `${key.replace(/[^a-z0-9-]/gi, '_')}.json`);
}

export const fileCatalogStorage: CatalogStorage = {
  async read(key) {
    const file = catalogFile(key);
    return file.exists ? file.text() : null;
  },
  async write(key, text) {
    const file = catalogFile(key);
    if (!file.exists) file.create();
    file.writeSync(text);
  },
};
