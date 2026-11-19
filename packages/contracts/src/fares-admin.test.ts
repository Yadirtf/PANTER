import { describe, expect, it } from 'vitest';
import {
  FareHistoryQuerySchema,
  fareGeofencePath,
  fareRulePath,
  GeofenceUpdateBodySchema,
} from './index';

describe('administración de tarifas (HU-401)', () => {
  it('rutas de edición', () => {
    expect(fareRulePath('MOTOTAXI')).toBe('/admin/fares/rules/MOTOTAXI');
    expect(fareGeofencePath('6c1f8a2e-0b7d-4f3a-9c51-1a2b3c4d5e01')).toBe(
      '/admin/fares/geofences/6c1f8a2e-0b7d-4f3a-9c51-1a2b3c4d5e01',
    );
  });

  it('el cuerpo de la geocerca no lleva id ni kind', () => {
    const body = {
      name: 'Aeropuerto Cananguchal (VGZ)',
      polygon: [
        [
          { lat: 0.972, lng: -76.612 },
          { lat: 0.972, lng: -76.598 },
          { lat: 0.986, lng: -76.598 },
        ],
      ],
      surcharge: 5000,
      appliesTo: ['TAXI'],
      active: true,
    };
    expect(GeofenceUpdateBodySchema.parse({ ...body, kind: 'AIRPORT' })).toEqual(body);
    expect(GeofenceUpdateBodySchema.safeParse({ ...body, appliesTo: [] }).success).toBe(false);
    // Sin polígono (la web aún no lo edita): se conserva el actual.
    const { polygon: _polygon, ...withoutPolygon } = body;
    expect(GeofenceUpdateBodySchema.parse(withoutPolygon)).toEqual(withoutPolygon);
  });

  it('historial: límite por defecto y máximo', () => {
    expect(FareHistoryQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(FareHistoryQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});
