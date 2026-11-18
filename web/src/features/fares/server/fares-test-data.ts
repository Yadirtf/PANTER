// Datos solo para pruebas de la edición de tarifas (HU-403): los valores de la semilla 0005.
import type { FareChange, FareRule, Geofence } from '@panter/contracts';

export const AIRPORT_ID = '6c1f8a2e-0b7d-4f3a-9c51-1a2b3c4d5e01';
export const PERIPHERAL_ID = '6c1f8a2e-0b7d-4f3a-9c51-1a2b3c4d5e02';

const rule = (overrides: Partial<FareRule> & Pick<FareRule, 'vehicleType'>): FareRule => ({
  pricingModel: 'METERED',
  baseFare: 6000,
  perKm: 1200,
  perMinute: 150,
  minimumFare: 6000,
  nightSurcharge: 2000,
  nightStartMinute: 1200,
  nightEndMinute: 300,
  roundTo: 100,
  active: true,
  updatedAt: '2026-11-01T14:00:00.000Z',
  updatedBy: null,
  ...overrides,
});

export const MOTOTAXI_RULE = rule({
  vehicleType: 'MOTOTAXI',
  pricingModel: 'FLAT',
  baseFare: 3000,
  perKm: 0,
  perMinute: 0,
  minimumFare: 3000,
  nightSurcharge: 1000,
});
export const TAXI_RULE = rule({ vehicleType: 'TAXI' });
export const JEEP_RULE = rule({
  vehicleType: 'JEEP_4X4',
  baseFare: 15000,
  perKm: 2500,
  perMinute: 0,
  minimumFare: 30000,
  nightSurcharge: 5000,
  roundTo: 1000,
  active: false,
});

const square = (west: number, south: number, east: number, north: number) => [
  { lat: south, lng: west },
  { lat: south, lng: east },
  { lat: north, lng: east },
  { lat: north, lng: west },
  { lat: south, lng: west },
];

export const AIRPORT: Geofence = {
  id: AIRPORT_ID,
  name: 'Aeropuerto Cananguchal (VGZ)',
  kind: 'AIRPORT',
  polygon: [square(-76.612, 0.972, -76.598, 0.986)],
  surcharge: 5000,
  appliesTo: ['TAXI', 'MOTOTAXI'],
  active: true,
};

export const PERIPHERAL: Geofence = {
  id: PERIPHERAL_ID,
  name: 'Zona periférica de Villagarzón',
  kind: 'PERIPHERAL',
  polygon: [square(-76.65, 1.0, -76.585, 1.06), square(-76.628, 1.02, -76.605, 1.04)],
  surcharge: 1000,
  appliesTo: ['MOTOTAXI'],
  active: true,
};

export const CONFIG = {
  rules: [MOTOTAXI_RULE, TAXI_RULE, JEEP_RULE],
  geofences: [AIRPORT, PERIPHERAL],
};

export const RULE_CHANGE: FareChange = {
  id: '0b5f1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
  entity: 'FARE_RULE',
  entityKey: 'TAXI',
  before: { ...TAXI_RULE },
  after: {
    ...TAXI_RULE,
    baseFare: 6500,
    nightStartMinute: 1140,
    updatedAt: '2026-11-18T01:30:00.000Z',
  },
  changedBy: 'admin@panter.test',
  // 18 nov 2026 01:30 UTC = 17 nov 2026, 20:30 en Colombia.
  changedAt: '2026-11-18T01:30:00.000Z',
};

export const GEOFENCE_CHANGE: FareChange = {
  id: '1c6a2d3e-4f5a-4b6c-9d7e-8f9a0b1c2d3e',
  entity: 'GEOFENCE',
  entityKey: AIRPORT_ID,
  before: { name: AIRPORT.name, surcharge: 5000, applies_to: ['TAXI', 'MOTOTAXI'], active: true },
  after: { name: AIRPORT.name, surcharge: 6000, applies_to: ['MOTOTAXI', 'TAXI'], active: false },
  changedBy: null,
  changedAt: '2026-11-17T15:00:00.000Z',
};
