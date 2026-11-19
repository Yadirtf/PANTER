import { z } from 'zod';
import { VehicleTypeSchema } from './enums';

/**
 * Eventos de dominio publicados en la cola EVENTS (especificación §3). Se versionan con
 * `version`: un consumidor ignora las versiones que no conoce.
 */
export const DomainEventType = {
  /** HU-204: un ADMIN aprobó a un conductor y se le otorgó el rol DRIVER. */
  DRIVER_APPROVED: 'DriverApproved',
} as const;
export type DomainEventType = (typeof DomainEventType)[keyof typeof DomainEventType];

export const DriverApprovedEventSchema = z.object({
  type: z.literal(DomainEventType.DRIVER_APPROVED),
  version: z.literal(1),
  /** Identificador único (idempotencia de los consumidores). */
  eventId: z.uuid(),
  occurredAt: z.iso.datetime(),
  payload: z.object({
    userId: z.uuid(),
    vehicleType: VehicleTypeSchema,
    plate: z.string(),
    /** ADMIN que aprobó. */
    approvedBy: z.uuid(),
  }),
});
export type DriverApprovedEvent = z.infer<typeof DriverApprovedEventSchema>;

export const DomainEventSchema = z.discriminatedUnion('type', [DriverApprovedEventSchema]);
export type DomainEvent = z.infer<typeof DomainEventSchema>;
