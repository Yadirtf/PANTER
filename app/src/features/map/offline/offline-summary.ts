// Resumen de una línea del mapa sin señal (encabezado del panel del conductor).
import { formatBytes, progressPercent } from './format';
import type { OfflineMapSnapshot } from './offline-types';

/** "20261118" → "18/11/2026". */
export function formatBuildDate(build: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(build);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : build;
}

export function offlineSummary(snapshot: OfflineMapSnapshot): string {
  const { download, current, updateAvailable } = snapshot;
  switch (download.status) {
    case 'downloading':
      return download.phase === 'tiles'
        ? `Descargando mapa: ${progressPercent(download.receivedBytes, download.totalBytes)} %`
        : 'Terminando la descarga del mapa…';
    case 'interrupted':
      return `Descarga en pausa: ${formatBytes(download.receivedBytes)} de ${formatBytes(download.totalBytes)}`;
    case 'no-space':
      return 'Sin espacio para el mapa sin señal';
    case 'failed':
      return 'La descarga del mapa falló';
    case 'idle':
      if (current && updateAvailable) return 'Hay un mapa nuevo para descargar';
      if (current) return 'Mapa sin señal listo';
      return 'Descargar mapa para usar sin señal';
  }
}
