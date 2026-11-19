// Descargas del mapa sin señal con `fetch`: el .pmtiles por rangos (GET /tiles/<archivo> con
// Range responde 206 + Content-Range) y los glifos y sprites completos.
import { expoNetworkMonitor } from '../../driver-onboarding/native/network-monitor';
import {
  OfflineFetchError,
  type OfflineMapNetwork,
  totalFromContentRange,
} from '../offline/offline-types';

/** Tiempo máximo por bloque de 2 MB (con señal 3G débil en zona rural). */
const REQUEST_TIMEOUT_MS = 60_000;

async function get(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new OfflineFetchError('network', error instanceof Error ? error.message : 'Sin red');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

async function body(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (signal.aborted) throw error;
    // La conexión se cortó a mitad del cuerpo.
    throw new OfflineFetchError('network', error instanceof Error ? error.message : 'Sin red');
  }
}

const serverError = (response: Response) =>
  new OfflineFetchError('server', `La API respondió ${response.status}`);

export const fetchOfflineNetwork: OfflineMapNetwork = {
  async fetchRange(url, offset, length, signal) {
    const response = await get(url, { Range: `bytes=${offset}-${offset + length - 1}` }, signal);
    if (response.status !== 206) {
      if (response.status === 200 || response.status === 416 || response.status === 404) {
        // Sin soporte de rangos o el archivo ya no está publicado: no se puede reanudar.
        throw new OfflineFetchError('mismatch', `La API respondió ${response.status} al rango`);
      }
      throw serverError(response);
    }
    const total = totalFromContentRange(response.headers.get('Content-Range'));
    if (total === null) throw new OfflineFetchError('mismatch', 'Content-Range inválido');
    return { bytes: await body(response, signal), total };
  },
  async fetchBytes(url, signal) {
    const response = await get(url, {}, signal);
    if (!response.ok) throw serverError(response);
    return body(response, signal);
  },
  isOnline: expoNetworkMonitor.isOnline,
  subscribe: expoNetworkMonitor.subscribe,
};
