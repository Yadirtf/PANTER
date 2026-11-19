import { PLACES } from '@panter/contracts';
import {
  basemapUrls,
  buildStyle,
  parseBasemapManifest,
  SERVICE_AREA_BOUNDS,
  type BasemapManifest,
  type BuildStyleOptions,
  type MapTheme,
} from '@panter/map-style';

/**
 * Mapa base de PANTER en la web (HU-304): el manifiesto `/tiles/basemap.json` de panter-api
 * dice qué extracto `.pmtiles` está vigente; con él se arman las URLs y el estilo de map-style.
 * Las teselas son públicas (CORS abierto, sin credenciales): nunca se envía el token de sesión.
 */

export const BASEMAP_MANIFEST_PATH = '/tiles/basemap.json';

export type BasemapUrls = Omit<BuildStyleOptions, 'theme'>;

export interface Basemap {
  manifest: BasemapManifest;
  urls: BasemapUrls;
}

/** Vista inicial: centro de Villagarzón, sin salir del área de servicio (la caja del .pmtiles). */
export const MAP_VIEW = {
  center: [PLACES.VILLAGARZON_CENTER.lng, PLACES.VILLAGARZON_CENTER.lat] as [number, number],
  zoom: 13,
  minZoom: 8,
  maxZoom: 18,
  maxBounds: SERVICE_AREA_BOUNDS,
} as const;

/** Textos de los controles de MapLibre en español. */
export const MAP_LOCALE_ES: Record<string, string> = {
  'AttributionControl.ToggleAttribution': 'Mostrar u ocultar los créditos del mapa',
  'AttributionControl.MapFeedback': 'Reportar un error del mapa',
  'FullscreenControl.Enter': 'Ver en pantalla completa',
  'FullscreenControl.Exit': 'Salir de pantalla completa',
  'GeolocateControl.FindMyLocation': 'Mostrar mi ubicación',
  'GeolocateControl.LocationNotAvailable': 'Ubicación no disponible',
  'LogoControl.Title': 'Logo de MapLibre',
  'Map.Title': 'Mapa',
  'Marker.Title': 'Marcador',
  'NavigationControl.ResetBearing': 'Restablecer el norte',
  'NavigationControl.ZoomIn': 'Acercar',
  'NavigationControl.ZoomOut': 'Alejar',
  'Popup.Close': 'Cerrar',
  'ScaleControl.Meters': 'm',
  'ScaleControl.Kilometers': 'km',
  'CooperativeGesturesHandler.WindowsHelpText': 'Usa Ctrl + rueda del ratón para acercar el mapa',
  'CooperativeGesturesHandler.MacHelpText': 'Usa ⌘ + rueda del ratón para acercar el mapa',
  'CooperativeGesturesHandler.MobileHelpText': 'Usa dos dedos para mover el mapa',
};

export const BASEMAP_ERROR_MESSAGE =
  'No pudimos cargar el mapa. Revisa tu conexión e intenta de nuevo.';

export class BasemapError extends Error {
  override readonly name = 'BasemapError';
  constructor(readonly reason: 'network' | 'http' | 'format') {
    super(BASEMAP_ERROR_MESSAGE);
  }
}

export function basemapManifestUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '')}${BASEMAP_MANIFEST_PATH}`;
}

/**
 * Lee el manifiesto y arma las URLs del mapa base. Petición anónima (`credentials: 'omit'`, sin
 * Authorization): las teselas no dependen de la sesión.
 */
export async function loadBasemap(
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Basemap> {
  let response: Response;
  try {
    response = await fetchImpl(basemapManifestUrl(apiUrl), {
      method: 'GET',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new BasemapError('network');
  }
  if (!response.ok) throw new BasemapError('http');
  let manifest: BasemapManifest;
  try {
    manifest = parseBasemapManifest(await response.json());
  } catch {
    throw new BasemapError('format');
  }
  return { manifest, urls: basemapUrls(apiUrl, manifest) };
}

/** Estilo de PANTER para el tema dado. */
export function panterStyle(urls: BasemapUrls, theme: MapTheme) {
  return buildStyle({ ...urls, theme });
}
