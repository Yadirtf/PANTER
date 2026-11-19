// Instancias únicas del mapa: copia sin señal del conductor y caché del manifiesto.
import { env } from '../../config/env';
import { fileManifestCache } from './native/manifest-cache';
import { fetchOfflineNetwork } from './native/offline-network';
import { fileOfflineStorage } from './native/offline-storage';
import { OfflineMapManager } from './offline/offline-map';

export const mapApiUrl = env.apiUrl;

export const manifestCache = fileManifestCache;

export const offlineMap = new OfflineMapManager({
  storage: fileOfflineStorage,
  network: fetchOfflineNetwork,
  apiUrl: env.apiUrl,
});

export const offlineRootUri = () => fileOfflineStorage.rootUri();
