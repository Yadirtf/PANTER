// Datos solo para pruebas del catálogo geográfico (E15): barrios, veredas y lugares de Villagarzón.
import type { Area, AreaSummary, CatalogChange, LatLng, Place } from '@panter/contracts';

export const CENTRO_ID = '7d2e9b3f-1c8a-4e5b-8f60-2b3c4d5e6f01';
export const SAN_JOSE_ID = '7d2e9b3f-1c8a-4e5b-8f60-2b3c4d5e6f02';
export const ALTO_SINAI_ID = '7d2e9b3f-1c8a-4e5b-8f60-2b3c4d5e6f03';
export const VIEJO_ID = '7d2e9b3f-1c8a-4e5b-8f60-2b3c4d5e6f04';

/** Rectángulo cerrado (último = primero), como lo devuelve la API. */
export const square = (west: number, south: number, east: number, north: number): LatLng[] => [
  { lat: south, lng: west },
  { lat: south, lng: east },
  { lat: north, lng: east },
  { lat: north, lng: west },
  { lat: south, lng: west },
];

const area = (overrides: Partial<Area> & Pick<Area, 'id' | 'name' | 'kind' | 'polygon'>): Area => ({
  active: true,
  source: 'Alcaldía de Villagarzón – POT',
  center: { lat: 1.0295, lng: -76.6165 },
  updatedAt: '2026-11-15T14:00:00.000Z',
  updatedBy: null,
  ...overrides,
});

/** Casco urbano: el Parque principal (1,0295; −76,6165) queda dentro. */
export const CENTRO = area({
  id: CENTRO_ID,
  name: 'Centro',
  kind: 'BARRIO',
  polygon: [square(-76.62, 1.026, -76.613, 1.033)],
});

/** Vecino al oriente: comparte el borde lng = −76,613 con el Centro (no se solapan). */
export const SAN_JOSE = area({
  id: SAN_JOSE_ID,
  name: 'San José',
  kind: 'BARRIO',
  polygon: [square(-76.613, 1.026, -76.606, 1.033)],
});

export const ALTO_SINAI = area({
  id: ALTO_SINAI_ID,
  name: 'Alto Sinaí',
  kind: 'VEREDA',
  source: null,
  polygon: [square(-76.66, 1.04, -76.64, 1.06)],
});

/** Desactivado y montado sobre el Centro (límite viejo). */
export const VIEJO = area({
  id: VIEJO_ID,
  name: 'Centro viejo',
  kind: 'BARRIO',
  active: false,
  polygon: [square(-76.618, 1.028, -76.615, 1.031)],
});

export const ALL_AREAS = [CENTRO, SAN_JOSE, ALTO_SINAI, VIEJO];

export const summary = ({ id, name, kind, active }: Area): AreaSummary => ({
  id,
  name,
  kind,
  active,
});

export const AREA_CHANGE: CatalogChange = {
  id: '8e3f0c4a-2d9b-4f6c-9a71-3c4d5e6f7a01',
  entity: 'AREA',
  entityId: CENTRO_ID,
  action: 'UPDATE',
  before: { name: 'Centro', kind: 'BARRIO', active: true, polygon: CENTRO.polygon },
  after: {
    name: 'Centro histórico',
    kind: 'BARRIO',
    active: true,
    polygon: [
      [
        ...CENTRO.polygon[0]!.slice(0, 2),
        { lat: 1.0295, lng: -76.611 },
        ...CENTRO.polygon[0]!.slice(2),
      ],
    ],
  },
  changedBy: 'admin@panter.test',
  changedAt: '2026-11-16T15:30:00.000Z',
};

// --- Lugares (HU-310): la semilla 0007 de api-core y uno verificado ---

const place = (
  overrides: Partial<Place> & Pick<Place, 'id' | 'slug' | 'name' | 'category' | 'location'>,
): Place => ({
  pickupPoint: null,
  area: null,
  verified: false,
  active: true,
  source: 'Estimación de zona (error 5–8 km). Corregir con la ubicación real',
  updatedAt: '2026-11-15T14:00:00.000Z',
  ...overrides,
});

export const AIRPORT_PLACE = place({
  id: '9f4a1d5b-3e0c-4a7d-8b82-4d5e6f7a8b01',
  slug: 'aeropuerto-cananguchal',
  name: 'Aeropuerto Cananguchal',
  category: 'AIRPORT',
  location: { lat: 0.9789, lng: -76.6053 },
  verified: true,
  source: 'Coordenada publicada del aeródromo (SKVG/VGZ)',
});

export const PARK_PLACE = place({
  id: '9f4a1d5b-3e0c-4a7d-8b82-4d5e6f7a8b02',
  slug: 'parque-principal',
  name: 'Parque principal',
  category: 'PARK',
  location: { lat: 1.0295, lng: -76.6165 },
  area: { id: CENTRO_ID, name: 'Centro', kind: 'BARRIO', active: true },
  source: 'Centro urbano de Villagarzón, sin verificar en sitio (error ≈ 300 m)',
});

export const POZO_AZUL = place({
  id: '9f4a1d5b-3e0c-4a7d-8b82-4d5e6f7a8b03',
  slug: 'pozo-azul',
  name: 'Pozo Azul',
  category: 'TOURISM',
  location: { lat: 1.045, lng: -76.64 },
});

export const HOSPITAL = place({
  id: '9f4a1d5b-3e0c-4a7d-8b82-4d5e6f7a8b04',
  slug: 'hospital-local',
  name: 'Hospital local',
  category: 'HEALTH',
  location: { lat: 1.0301, lng: -76.6181 },
  pickupPoint: { lat: 1.0303, lng: -76.6178 },
  area: { id: CENTRO_ID, name: 'Centro', kind: 'BARRIO', active: true },
  verified: true,
  active: false,
  source: 'GPS en sitio',
});

export const ALL_PLACES = [AIRPORT_PLACE, PARK_PLACE, POZO_AZUL, HOSPITAL];

export const PLACE_CHANGE: CatalogChange = {
  id: '8e3f0c4a-2d9b-4f6c-9a71-3c4d5e6f7a02',
  entity: 'PLACE',
  entityId: POZO_AZUL.id,
  action: 'UPDATE',
  before: { name: 'Pozo Azul', category: 'TOURISM', location: POZO_AZUL.location, verified: false },
  after: {
    name: 'Pozo Azul',
    category: 'PARK',
    location: { lat: 1.0512, lng: -76.6433 },
    verified: true,
  },
  changedBy: 'admin@panter.test',
  changedAt: '2026-11-20T16:00:00.000Z',
};
