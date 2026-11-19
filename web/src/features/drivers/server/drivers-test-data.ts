// Datos y API simulada solo para pruebas de la revisión de conductores (HU-204).
import {
  REQUIRED_DOCUMENTS,
  type AdminDriver,
  type DocumentStatus,
  type DriverDocument,
} from '@panter/contracts';
import { vi } from 'vitest';

export const DRIVER_ID = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';
export const DRIVER_2_ID = '6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e';

export function doc(
  type: DriverDocument['type'],
  status: DocumentStatus = 'SUBMITTED',
  overrides: Partial<DriverDocument> = {},
): DriverDocument {
  return {
    type,
    status,
    contentType: 'image/jpeg',
    sizeBytes: 512_000,
    uploadedAt: '2026-11-10T14:00:00.000Z',
    reviewedAt: status === 'SUBMITTED' ? null : '2026-11-11T15:00:00.000Z',
    rejectionReason: status === 'REJECTED' ? 'La foto está borrosa' : null,
    ...overrides,
  };
}

/** Mototaxista con 3 de 5 documentos subidos (faltan SOAT y técnico-mecánica). */
export function pendingDriver(overrides: Partial<AdminDriver> = {}): AdminDriver {
  return {
    userId: DRIVER_ID,
    email: 'carlos@panter.test',
    fullName: 'Carlos Mototaxista',
    phone: '+573101234567',
    reviewedBy: null,
    vehicle: {
      vehicleType: 'MOTOTAXI',
      plate: 'ABC12D',
      brand: 'AKT',
      model: 'NKD 125',
      color: 'Rojo',
      year: 2022,
    },
    verificationStatus: 'PENDING',
    availability: 'OFFLINE',
    rejectionReason: null,
    // 10 nov 2026 14:00 UTC = 9:00 a. m. en Colombia.
    appliedAt: '2026-11-10T14:00:00.000Z',
    reviewedAt: null,
    documents: [doc('CEDULA', 'APPROVED'), doc('LICENCIA'), doc('TARJETA_PROPIEDAD', 'REJECTED')],
    missingDocuments: ['TARJETA_PROPIEDAD', 'SOAT', 'TECNOMECANICA'],
    ...overrides,
  };
}

/** Taxista con los 5 documentos aprobados. */
export function completeDriver(overrides: Partial<AdminDriver> = {}): AdminDriver {
  return pendingDriver({
    userId: DRIVER_2_ID,
    email: 'taxi@panter.test',
    fullName: null,
    vehicle: {
      vehicleType: 'TAXI',
      plate: 'TQX123',
      brand: 'Chevrolet',
      model: 'Spark',
      color: 'Amarillo',
      year: 2019,
    },
    documents: REQUIRED_DOCUMENTS.map((type) => doc(type, 'APPROVED')),
    missingDocuments: [],
    ...overrides,
  });
}

export type Handler = (request: Request) => Response | Promise<Response>;

/** API simulada: responde según "MÉTODO /ruta"; un arreglo da respuestas sucesivas. */
export function mockFetch(routes: Record<string, Handler | Handler[]>) {
  const calls = new Map<string, number>();
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const entry = routes[key];
    if (!entry) throw new Error(`Ruta no simulada: ${key}`);
    const n = calls.get(key) ?? 0;
    calls.set(key, n + 1);
    const handler = Array.isArray(entry) ? entry[Math.min(n, entry.length - 1)]! : entry;
    return handler(new Request(url, init));
  });
}
