// Última copia de basemap.json en el teléfono: con ella se arma el estilo aunque no haya señal.
import { type BasemapManifest, parseBasemapManifest } from '@panter/map-style';
import { Directory, File, Paths } from 'expo-file-system';
import type { ManifestCache } from '../basemap/manifest';

function cacheFile(): File {
  const directory = new Directory(Paths.document, 'map');
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return new File(directory, 'basemap.json');
}

export const fileManifestCache: ManifestCache = {
  async load(): Promise<BasemapManifest | null> {
    const file = cacheFile();
    if (!file.exists) return null;
    try {
      return parseBasemapManifest(JSON.parse(await file.text()));
    } catch {
      return null;
    }
  },
  async save(manifest) {
    const file = cacheFile();
    if (!file.exists) file.create();
    file.writeSync(JSON.stringify(manifest));
  },
};
