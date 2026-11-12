import { describe, expect, it } from 'vitest';
import {
  ActiveModeSchema,
  isStaffRole,
  Role,
  RoleSchema,
  TripStatus,
  TripStatusSchema,
  VehicleTypeSchema,
} from './index';

describe('enums de contracts', () => {
  it('valida roles conocidos y rechaza desconocidos', () => {
    expect(RoleSchema.parse('DRIVER')).toBe(Role.DRIVER);
    expect(RoleSchema.safeParse('SUPERUSER').success).toBe(false);
  });

  it('identifica roles de personal', () => {
    expect(isStaffRole(Role.ADMIN)).toBe(true);
    expect(isStaffRole(Role.DISPATCHER)).toBe(true);
    expect(isStaffRole(Role.TOUR_OPERATOR)).toBe(true);
    expect(isStaffRole(Role.PASSENGER)).toBe(false);
    expect(isStaffRole(Role.DRIVER)).toBe(false);
  });

  it('el modo activo solo admite passenger o driver', () => {
    expect(ActiveModeSchema.options).toEqual(['passenger', 'driver']);
  });

  it('incluye los 8 estados del viaje de RF-06', () => {
    expect(TripStatusSchema.options).toHaveLength(8);
    expect(TripStatusSchema.parse('CANCELLED')).toBe(TripStatus.CANCELLED);
  });

  it('incluye mototaxi, taxi y 4x4', () => {
    expect(VehicleTypeSchema.options).toEqual(['MOTOTAXI', 'TAXI', 'JEEP_4X4']);
  });
});
