// Textos de la descarga sin señal: tamaños en MB/GB con coma decimal y porcentaje.
import type { DownloadState } from './offline-types';

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** 85 MB → "85 MB"; 1,5 GB → "1,5 GB"; 512 KB → "0,5 MB". */
export function formatBytes(bytes: number): string {
  const value = Math.max(0, bytes);
  const [amount, unit] = value >= GB ? [value / GB, 'GB'] : [value / MB, 'MB'];
  // Sin Intl: el formato es igual en Hermes y en Node (pruebas).
  const fixed = amount >= 100 ? amount.toFixed(0) : amount.toFixed(1).replace(/\.0$/, '');
  return `${fixed.replace('.', ',')} ${unit}`;
}

/** Progreso entero 0–100 (nunca 100 antes de terminar). */
export function progressPercent(received: number, total: number): number {
  if (total <= 0) return 0;
  const percent = Math.floor((received / total) * 100);
  return Math.min(received >= total ? 100 : 99, Math.max(0, percent));
}

/** Línea de estado de la descarga para la pantalla del conductor. */
export function downloadStatusText(state: DownloadState): string | null {
  switch (state.status) {
    case 'idle':
      return null;
    case 'downloading': {
      if (state.phase === 'assets') return 'Guardando letras e íconos del mapa…';
      if (state.phase === 'verifying') return 'Verificando el archivo…';
      const percent = progressPercent(state.receivedBytes, state.totalBytes);
      return `Descargando ${formatBytes(state.receivedBytes)} de ${formatBytes(state.totalBytes)} (${percent} %)`;
    }
    case 'interrupted':
      return `${state.message} Llevas ${formatBytes(state.receivedBytes)} de ${formatBytes(state.totalBytes)}.`;
    case 'no-space':
      return `No hay espacio suficiente: se necesitan ${formatBytes(state.requiredBytes)} libres y tienes ${formatBytes(state.availableBytes)}. Libera espacio e intenta de nuevo.`;
    case 'failed':
      return state.message;
  }
}
