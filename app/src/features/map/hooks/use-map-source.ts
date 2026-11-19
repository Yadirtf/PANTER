// Fuente del mapa (panter-api o copia local) según el manifiesto, la red y la copia del
// conductor. Vuelve a pedir el manifiesto cuando regresa la señal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { expoNetworkMonitor } from '../../driver-onboarding/native/network-monitor';
import { httpClient } from '../../auth/session/instance';
import { loadManifest, type ManifestResult } from '../basemap/manifest';
import { type MapSource, resolveMapSource } from '../basemap/map-source';
import { manifestCache, mapApiUrl, offlineMap, offlineRootUri } from '../instance';
import { useOfflineMap } from './use-offline-map';

export interface MapSourceState {
  /** `null` mientras se consulta el manifiesto por primera vez. */
  source: MapSource | null;
  online: boolean;
  reload: () => void;
}

export function useMapSource(mode: 'passenger' | 'driver'): MapSourceState {
  const offline = useOfflineMap(mode === 'driver');
  const [manifest, setManifest] = useState<ManifestResult | null>(null);
  const [online, setOnline] = useState(true);

  const reload = useCallback(() => {
    void loadManifest(httpClient, manifestCache).then((result) => {
      setManifest(result);
      if (result.fresh && result.manifest) offlineMap.setLatest(result.manifest);
    });
  }, []);

  useEffect(() => {
    reload();
    void expoNetworkMonitor.isOnline().then(setOnline);
    return expoNetworkMonitor.subscribe((value) => {
      setOnline(value);
      if (value) reload();
    });
  }, [reload]);

  const current = mode === 'driver' ? offline.current : null;
  const source = useMemo(() => {
    if (!manifest) return null;
    return resolveMapSource({
      apiUrl: mapApiUrl,
      manifest: manifest.manifest,
      manifestFresh: manifest.fresh,
      online,
      local: current
        ? { build: current.build, file: current.file, rootUri: offlineRootUri() }
        : null,
    });
  }, [manifest, online, current]);

  return { source, online, reload };
}
