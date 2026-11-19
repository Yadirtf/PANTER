import { PLACES, type LatLng } from '@panter/contracts';
import type { PlaceIconId } from './icons';

/**
 * Puntos clave de Villagarzón que el mapa muestra siempre, con ícono propio (§6.1).
 *
 * VERIFICAR EN HU-1102 (prueba de campo): las coordenadas con `approximate: true` NO están
 * confirmadas; son una estimación para que el punto aparezca en la zona correcta y deben
 * reemplazarse por las tomadas en sitio con GPS (y cotejarse con OpenStreetMap) antes de usarlas
 * para geocercas, tarifas o navegación. `uncertaintyMeters` es el radio de error estimado.
 */
export interface KeyPlace {
  id: string;
  /** Nombre visible en el mapa, en español. */
  name: string;
  icon: PlaceIconId;
  position: LatLng;
  approximate: boolean;
  uncertaintyMeters: number;
  /** De dónde sale la coordenada. */
  source: string;
}

export const KEY_PLACES: readonly KeyPlace[] = [
  {
    id: 'aeropuerto-cananguchal',
    name: 'Aeropuerto Cananguchal',
    icon: 'place-airport',
    position: PLACES.AIRPORT_VGZ,
    // Coordenada publicada del aeródromo (OACI SKVG, IATA VGZ); punto de referencia de la pista,
    // no necesariamente de la terminal ni de la entrada de vehículos.
    approximate: false,
    uncertaintyMeters: 500,
    source: 'Coordenada publicada del aeródromo (SKVG/VGZ); PLACES.AIRPORT_VGZ de contracts',
  },
  {
    id: 'parque-principal',
    name: 'Parque principal',
    icon: 'place-park',
    position: PLACES.VILLAGARZON_CENTER,
    approximate: true,
    uncertaintyMeters: 300,
    source: 'Centro urbano de Villagarzón (PLACES.VILLAGARZON_CENTER), sin verificar en sitio',
  },
  {
    id: 'pozo-azul',
    name: 'Pozo Azul',
    icon: 'place-pool',
    position: { lat: 1.045, lng: -76.64 },
    approximate: true,
    uncertaintyMeters: 5000,
    source: 'Estimación: zona rural cercana al casco urbano. Ubicación exacta desconocida',
  },
  {
    id: 'rio-guineo',
    name: 'Río Guineo',
    icon: 'place-river',
    position: { lat: 0.99, lng: -76.65 },
    approximate: true,
    uncertaintyMeters: 5000,
    source: 'Estimación: punto de acceso al río sin confirmar. Ubicación exacta desconocida',
  },
  {
    id: 'cascadas-de-vica',
    name: 'Cascadas de Vica',
    icon: 'place-waterfall',
    position: { lat: 1.07, lng: -76.67 },
    approximate: true,
    uncertaintyMeters: 8000,
    source: 'Estimación: piedemonte al noroccidente del casco urbano. Ubicación exacta desconocida',
  },
  {
    id: 'mohano',
    name: 'Mohano',
    icon: 'place-nature',
    position: { lat: 0.96, lng: -76.58 },
    approximate: true,
    uncertaintyMeters: 8000,
    source: 'Estimación: zona rural de Villagarzón. Ubicación exacta desconocida',
  },
];

export interface KeyPlaceFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { id: string; name: string; icon: PlaceIconId; approximate: boolean };
}

/** Puntos clave como GeoJSON (fuente `panter-places` del estilo). */
export function keyPlacesGeoJson(): { type: 'FeatureCollection'; features: KeyPlaceFeature[] } {
  return {
    type: 'FeatureCollection',
    features: KEY_PLACES.map((place) => ({
      type: 'Feature',
      id: place.id,
      geometry: { type: 'Point', coordinates: [place.position.lng, place.position.lat] },
      properties: {
        id: place.id,
        name: place.name,
        icon: place.icon,
        approximate: place.approximate,
      },
    })),
  };
}
