import { describe, expect, it } from 'vitest';
import {
  DocumentReviewBodySchema,
  DriverApplyBodySchema,
  FareEstimateBodySchema,
  FareRuleUpdateBodySchema,
  RouteQuerySchema,
  documentUploadUrlPath,
  DocumentUploadUrlBodySchema,
  DOCUMENT_MAX_BYTES,
} from './index';

const vehicle = { brand: 'AKT', model: 'NKD 125', color: 'Rojo', year: 2022 };

describe('solicitud de conductor', () => {
  it('normaliza y valida placas de moto y de carro', () => {
    expect(
      DriverApplyBodySchema.parse({ ...vehicle, vehicleType: 'MOTOTAXI', plate: 'abc 12d' }).plate,
    ).toBe('ABC12D');
    expect(
      DriverApplyBodySchema.parse({ ...vehicle, vehicleType: 'TAXI', plate: 'tqx-123' }).plate,
    ).toBe('TQX123');
    expect(
      DriverApplyBodySchema.safeParse({ ...vehicle, vehicleType: 'MOTOTAXI', plate: 'ABC123' })
        .success,
    ).toBe(false);
    expect(
      DriverApplyBodySchema.safeParse({ ...vehicle, vehicleType: 'JEEP_4X4', plate: 'ABC12D' })
        .success,
    ).toBe(false);
  });

  it('documentos: tamaño y tipo, y motivo obligatorio al rechazar', () => {
    expect(
      DocumentUploadUrlBodySchema.safeParse({
        contentType: 'image/jpeg',
        sizeBytes: DOCUMENT_MAX_BYTES + 1,
      }).success,
    ).toBe(false);
    expect(
      DocumentUploadUrlBodySchema.safeParse({ contentType: 'application/pdf', sizeBytes: 10 })
        .success,
    ).toBe(false);
    expect(DocumentReviewBodySchema.safeParse({ decision: 'REJECTED' }).success).toBe(false);
    expect(DocumentReviewBodySchema.safeParse({ decision: 'APPROVED' }).success).toBe(true);
    expect(documentUploadUrlPath('SOAT')).toBe('/drivers/me/documents/SOAT/upload-url');
  });
});

describe('tarifas y rutas', () => {
  it('estimado y regla', () => {
    expect(
      FareEstimateBodySchema.safeParse({
        origin: { lat: 1.0295, lng: -76.6165 },
        destination: { lat: 0.9789, lng: -76.6053 },
        vehicleType: 'TAXI',
      }).success,
    ).toBe(true);
    expect(
      FareRuleUpdateBodySchema.safeParse({
        pricingModel: 'FLAT',
        baseFare: 3000,
        perKm: 0,
        perMinute: 0,
        minimumFare: 3000,
        nightSurcharge: 1000,
        nightStartMinute: 1200,
        nightEndMinute: 300,
        roundTo: 100,
        active: true,
      }).success,
    ).toBe(true);
  });

  it('la query de rutas acepta "lat,lng"', () => {
    expect(
      RouteQuerySchema.parse({ origin: '1.0295,-76.6165', destination: '0.9789,-76.6053' }),
    ).toEqual({
      origin: { lat: 1.0295, lng: -76.6165 },
      destination: { lat: 0.9789, lng: -76.6053 },
      profile: 'driving-car',
    });
    expect(RouteQuerySchema.safeParse({ origin: 'x', destination: '1,2' }).success).toBe(false);
  });
});
