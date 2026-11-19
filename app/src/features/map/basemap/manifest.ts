// Manifiesto del mapa base (GET /tiles/basemap.json, HU-301): dice qué .pmtiles está vigente,
// cuánto pesa y su SHA-256. Se guarda la última copia para poder armar el estilo sin señal.
import { type BasemapManifest, parseBasemapManifest } from '@panter/map-style';
import { type ApiError, toApiError } from '../../../shared/api/errors';
import type { HttpClient, Schema } from '../../../shared/api/http-client';

export const BASEMAP_MANIFEST_PATH = '/tiles/basemap.json';

/** Adaptador de `parseBasemapManifest` a la interfaz de esquema del cliente HTTP. */
export const BasemapManifestSchema: Schema<BasemapManifest> = {
  safeParse(data) {
    try {
      return { success: true, data: parseBasemapManifest(data) };
    } catch (error) {
      return { success: false, error };
    }
  },
};

/** Última copia conocida del manifiesto (archivo en el teléfono). */
export interface ManifestCache {
  load(): Promise<BasemapManifest | null>;
  save(manifest: BasemapManifest): Promise<void>;
}

export interface ManifestResult {
  manifest: BasemapManifest | null;
  /** true si `manifest` viene de la API ahora; false si es la copia guardada (o no hay). */
  fresh: boolean;
  /** Error de la consulta, si falló. */
  error: ApiError | null;
}

/**
 * Pide el manifiesto vigente. Si la API no responde (sin señal, timeout, respuesta inválida),
 * devuelve la última copia guardada con `fresh: false` para que el mapa siga funcionando.
 */
export async function loadManifest(
  http: HttpClient,
  cache: ManifestCache,
): Promise<ManifestResult> {
  try {
    const manifest = await http.request({
      path: BASEMAP_MANIFEST_PATH,
      schema: BasemapManifestSchema,
    });
    try {
      await cache.save(manifest);
    } catch {
      // Guardar la copia es opcional: el mapa funciona igual con la red.
    }
    return { manifest, fresh: true, error: null };
  } catch (error) {
    const cached = await cache.load().catch(() => null);
    return { manifest: cached, fresh: false, error: toApiError(error) };
  }
}

/** true si el manifiesto publicado es de un build distinto al de la copia local. */
export function isNewerBuild(
  local: Pick<BasemapManifest, 'build' | 'file'> | null,
  latest: Pick<BasemapManifest, 'build' | 'file'> | null,
): boolean {
  if (!local || !latest) return false;
  return local.build !== latest.build || local.file !== latest.file;
}
