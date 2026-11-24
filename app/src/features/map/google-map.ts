// Ajustes puros del mapa de Google (react-native-maps con PROVIDER_GOOGLE): límites del área de
// servicio, cámara inicial y estilo nocturno. Sin dependencias nativas para poder probarlos.
import type { MapTheme } from '@panter/map-style';
import { type LatLng, PLACES, SERVICE_AREA } from '@panter/contracts';

export const INITIAL_ZOOM = 13;
export const USER_ZOOM = 16;
export const MIN_ZOOM = 8;
export const MAX_ZOOM = 19;
export const CAMERA_DURATION_MS = 800;

/** Coordenada en el formato de react-native-maps. */
export interface GoogleLatLng {
  latitude: number;
  longitude: number;
}

export const toGoogle = (p: LatLng): GoogleLatLng => ({ latitude: p.lat, longitude: p.lng });
export const fromGoogle = (p: GoogleLatLng): LatLng => ({ lat: p.latitude, lng: p.longitude });

/** Límites de la cámara (`setMapBoundaries(northEast, southWest)`): el área de servicio. */
export const MAP_BOUNDARIES: { northEast: GoogleLatLng; southWest: GoogleLatLng } = {
  northEast: { latitude: SERVICE_AREA.north, longitude: SERVICE_AREA.east },
  southWest: { latitude: SERVICE_AREA.south, longitude: SERVICE_AREA.west },
};

/** Cámara inicial: centro de Villagarzón. */
export const INITIAL_CAMERA = {
  center: toGoogle(PLACES.VILLAGARZON_CENTER),
  zoom: INITIAL_ZOOM,
  heading: 0,
  pitch: 0,
};

export interface MapStyleElement {
  featureType?: string;
  elementType?: string;
  stylers: Record<string, string | number>[];
}

/**
 * Estilo nocturno (20:00–05:00, como el mapa anterior), basado en el estilo "Night" de ejemplo de
 * Google. Los POI siguen visibles: se pueden tocar como destino.
 */
export const NIGHT_STYLE: readonly MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a9b4c2' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#746855' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2835' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
];

/** Estilo según el tema del reloj de Colombia: de día, el estilo normal de Google. */
export function mapStyleFor(theme: MapTheme): MapStyleElement[] {
  return theme === 'dark' ? [...NIGHT_STYLE] : [];
}

/** Margen igual en los cuatro lados para `fitToCoordinates`. */
export function edgePadding(padding: number) {
  return { top: padding, right: padding, bottom: padding, left: padding };
}
