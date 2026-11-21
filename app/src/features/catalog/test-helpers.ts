// Datos de prueba del catálogo que cumplen el contrato de packages/contracts/src/catalog.ts.
import type { Area, AreaSummary, LatLng, Place } from '@panter/contracts';

const UPDATED_AT = '2026-11-18T14:00:00.000Z';

/** Cuadrado de ~`half` grados alrededor de `center`, como anillo abierto. */
export function square(center: LatLng, half = 0.002): LatLng[] {
  return [
    { lat: center.lat - half, lng: center.lng - half },
    { lat: center.lat - half, lng: center.lng + half },
    { lat: center.lat + half, lng: center.lng + half },
    { lat: center.lat + half, lng: center.lng - half },
  ];
}

export const CENTRO_CENTER = { lat: 1.0295, lng: -76.6165 };

export function makeArea(overrides: Partial<Area> = {}): Area {
  const center = overrides.center ?? CENTRO_CENTER;
  return {
    id: '0b6f2c1e-3a4d-4e5f-8a9b-1c2d3e4f5a60',
    name: 'Centro',
    kind: 'BARRIO',
    active: true,
    polygon: [square(center)],
    source: 'Alcaldía de Villagarzón',
    center,
    updatedAt: UPDATED_AT,
    updatedBy: null,
    ...overrides,
  };
}

export function summary(area: Area): AreaSummary {
  return { id: area.id, name: area.name, kind: area.kind, active: area.active };
}

export const AREAS: AreaSummary[] = [
  { id: '0b6f2c1e-3a4d-4e5f-8a9b-1c2d3e4f5a60', name: 'Centro', kind: 'BARRIO', active: true },
  { id: '1c7a3d2f-4b5e-4f60-9b0c-2d3e4f5a6b71', name: 'San José', kind: 'BARRIO', active: true },
  { id: '2d8b4e3a-5c6f-4071-8c1d-3e4f5a6b7c82', name: 'Villa Rosa', kind: 'BARRIO', active: true },
  { id: '3e9c5f4b-6d70-4182-9d2e-4f5a6b7c8d93', name: 'Alto Guineo', kind: 'VEREDA', active: true },
  {
    id: '4fad6a5c-7e81-4293-8e3f-5a6b7c8d9ea4',
    name: 'Bajo Mansoyá',
    kind: 'VEREDA',
    active: true,
  },
  { id: '5abe7b6d-8f92-43a4-9f40-6b7c8d9eafb5', name: 'El Cedro', kind: 'VEREDA', active: false },
];

export function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: '7c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e',
    slug: 'aeropuerto-cananguchal',
    name: 'Aeropuerto Cananguchal',
    category: 'AIRPORT',
    location: { lat: 0.9789, lng: -76.6053 },
    pickupPoint: null,
    area: null,
    verified: true,
    active: true,
    source: 'Coordenada publicada del aeródromo (SKVG/VGZ)',
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

export const PLACES_CATALOG: Place[] = [
  makePlace({
    pickupPoint: { lat: 0.9801, lng: -76.6047 },
  }),
  makePlace({
    id: '8d2e3f4a-5b6c-4d7e-9f80-a12b3c4d5e6f',
    slug: 'parque-principal',
    name: 'Parque principal',
    category: 'PARK',
    location: CENTRO_CENTER,
    area: AREAS[0]!,
    verified: false,
  }),
  makePlace({
    id: '9e3f4a5b-6c7d-4e8f-8091-b23c4d5e6f70',
    slug: 'rio-guineo',
    name: 'Río Guineo',
    category: 'TOURISM',
    location: { lat: 0.99, lng: -76.65 },
    verified: false,
  }),
  makePlace({
    id: 'af4a5b6c-7d8e-4f90-91a2-c34d5e6f7081',
    slug: 'hospital-jorge-julio-guzman',
    name: 'Hospital Jorge Julio Guzmán',
    category: 'HEALTH',
    location: { lat: 1.0312, lng: -76.6181 },
    area: AREAS[1]!,
    verified: true,
  }),
  makePlace({
    id: 'b05b6c7d-8e9f-4a01-a2b3-d45e6f708192',
    slug: 'antiguo-matadero',
    name: 'Antiguo matadero',
    category: 'OTHER',
    location: { lat: 1.033, lng: -76.62 },
    active: false,
  }),
];
