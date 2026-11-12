import { z } from 'zod';

/** Roles de una cuenta (sección 5.2). Una persona puede tener varios. */
export const Role = {
  PASSENGER: 'PASSENGER',
  DRIVER: 'DRIVER',
  ADMIN: 'ADMIN',
  DISPATCHER: 'DISPATCHER',
  TOUR_OPERATOR: 'TOUR_OPERATOR',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const RoleSchema = z.enum(Role);

/** Roles de personal: solo operan en la web (sección 5.3). */
export const STAFF_ROLES = [Role.ADMIN, Role.DISPATCHER, Role.TOUR_OPERATOR] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(role: Role): role is StaffRole {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

/** Modo activo de la app móvil, incluido en el JWT como `activeMode`. */
export const ActiveMode = {
  PASSENGER: 'passenger',
  DRIVER: 'driver',
} as const;
export type ActiveMode = (typeof ActiveMode)[keyof typeof ActiveMode];
export const ActiveModeSchema = z.enum(ActiveMode);

/** Estados del viaje (RF-06). Las transiciones válidas se definen en HU-601. */
export const TripStatus = {
  REQUESTED: 'REQUESTED',
  ACCEPTED: 'ACCEPTED',
  EN_ROUTE: 'EN_ROUTE',
  ARRIVED: 'ARRIVED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  RATED: 'RATED',
  CANCELLED: 'CANCELLED',
} as const;
export type TripStatus = (typeof TripStatus)[keyof typeof TripStatus];
export const TripStatusSchema = z.enum(TripStatus);

/** Tipos de vehículo (sección 1.1). */
export const VehicleType = {
  MOTOTAXI: 'MOTOTAXI',
  TAXI: 'TAXI',
  JEEP_4X4: 'JEEP_4X4',
} as const;
export type VehicleType = (typeof VehicleType)[keyof typeof VehicleType];
export const VehicleTypeSchema = z.enum(VehicleType);
