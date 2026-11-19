// Copia del mapa sin señal con expo-file-system, en el directorio de documentos de la app (el
// sistema no lo limpia, a diferencia de la caché). Estructura:
//   offline-map/offline-map.json         estado (copia vigente, descarga pendiente)
//   offline-map/panter-AAAAMMDD.pmtiles  copia verificada
//   offline-map/panter-AAAAMMDD.pmtiles.part  descarga en curso
//   offline-map/fonts/<fuente>/<rango>.pbf, offline-map/sprites/v4/<tema>[@2x].{json,png}
// Las carpetas de fuentes llevan espacios ("Noto Sans Regular"): MapLibre Native codifica el
// fontstack en la URL (%20) y LocalFileSource la decodifica antes de abrir el archivo.
import { Directory, File, Paths } from 'expo-file-system';
import type { OfflineMapRecord, OfflineMapStorage } from '../offline/offline-types';

const ROOT_DIR = 'offline-map';
const RECORD_FILE = 'offline-map.json';

function root(): Directory {
  const directory = new Directory(Paths.document, ROOT_DIR);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

const partial = (file: string) => new File(root(), `${file}.part`);
const basemap = (file: string) => new File(root(), file);

function isRecord(value: unknown): value is OfflineMapRecord {
  return (
    typeof value === 'object' && value !== null && (value as { version?: unknown }).version === 1
  );
}

function remove(entry: File | Directory) {
  if (entry.exists) entry.delete();
}

export const fileOfflineStorage: OfflineMapStorage = {
  async loadRecord() {
    const file = new File(root(), RECORD_FILE);
    if (!file.exists) return null;
    try {
      const value: unknown = JSON.parse(await file.text());
      if (!isRecord(value)) return null;
      // Si el archivo de la copia ya no está (p. ej. se borraron los datos), se ignora.
      if (value.current && !basemap(value.current.file).exists) value.current = null;
      return value;
    } catch {
      return null;
    }
  },
  async saveRecord(record) {
    const directory = root();
    const file = new File(directory, RECORD_FILE);
    const temp = new File(directory, `${RECORD_FILE}.tmp`);
    remove(temp);
    temp.create();
    temp.writeSync(JSON.stringify(record));
    remove(file);
    temp.moveSync(file);
  },
  partialSize(file) {
    const part = partial(file);
    return part.exists ? (part.size ?? 0) : 0;
  },
  async appendPartial(file, offset, bytes) {
    const part = partial(file);
    if (!part.exists) part.create();
    const size = part.size ?? 0;
    if (size !== offset) throw new Error(`El archivo parcial mide ${size}, se esperaba ${offset}`);
    await part.write(bytes, { append: true });
  },
  deletePartial(file) {
    remove(partial(file));
  },
  completePartial(file) {
    const target = basemap(file);
    remove(target);
    partial(file).moveSync(target);
  },
  digest(file) {
    return basemap(file).digest('SHA-256');
  },
  deleteBasemap(file) {
    remove(basemap(file));
  },
  async writeAsset(path, bytes) {
    const parts = path.split('/');
    const name = parts.pop()!;
    const directory = new Directory(root(), ...parts);
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    const file = new File(directory, name);
    remove(file);
    file.create();
    await file.write(bytes);
  },
  deleteAssets() {
    remove(new Directory(root(), 'fonts'));
    remove(new Directory(root(), 'sprites'));
  },
  availableBytes() {
    return Paths.availableDiskSpace;
  },
  rootUri() {
    return root().uri;
  },
};
