// Estado de la copia del mapa sin señal (solo modo conductor).
import { useEffect, useSyncExternalStore } from 'react';
import { offlineMap } from '../instance';
import type { OfflineMapSnapshot } from '../offline/offline-types';

export function useOfflineMap(enabled = true): OfflineMapSnapshot {
  useEffect(() => {
    if (enabled) void offlineMap.init();
  }, [enabled]);
  return useSyncExternalStore(offlineMap.subscribe, offlineMap.getSnapshot, offlineMap.getSnapshot);
}
