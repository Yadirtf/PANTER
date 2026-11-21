import { afterEach, describe, expect, it, vi } from 'vitest';

const vehicle = {
  vehicleType: 'MOTOTAXI',
  plate: 'ABC12D',
  brand: 'Suzuki',
  model: 'GN 125',
  color: 'Negro',
  year: 2022,
};

describe('año del modelo del vehículo', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('el límite no se congela al cargar el módulo (Workers carga el script con el reloj en 1970)', async () => {
    // Simula la carga del script en Cloudflare Workers: Date vale el epoch.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    vi.resetModules();
    const { DriverApplyBodySchema } = await import('./drivers');

    // Ya atendiendo la petición, el reloj es el real.
    vi.setSystemTime(new Date('2026-11-21T13:28:00Z'));
    expect(DriverApplyBodySchema.safeParse(vehicle).success).toBe(true);
    expect(DriverApplyBodySchema.safeParse({ ...vehicle, year: 2027 }).success).toBe(true);
    expect(DriverApplyBodySchema.safeParse({ ...vehicle, year: 2028 }).success).toBe(false);
  });

  it('límites: 1980 en adelante y hasta el año siguiente al actual', async () => {
    const { DriverApplyBodySchema, maxVehicleYear, MIN_VEHICLE_YEAR } = await import('./drivers');
    expect(MIN_VEHICLE_YEAR).toBe(1980);
    expect(maxVehicleYear(new Date('2026-12-31T23:59:59Z'))).toBe(2027);
    expect(DriverApplyBodySchema.safeParse({ ...vehicle, year: 1979 }).success).toBe(false);
    expect(DriverApplyBodySchema.safeParse({ ...vehicle, year: 1980 }).success).toBe(true);
  });
});
