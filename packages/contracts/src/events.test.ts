import { describe, expect, it } from 'vitest';
import { DomainEventSchema, DriverApprovedEventSchema } from './index';

const event = {
  type: 'DriverApproved',
  version: 1,
  eventId: '6f9619ff-8b86-4d11-b42d-00c04fc964ff',
  occurredAt: '2026-11-19T15:00:00.000Z',
  payload: {
    userId: '00000000-0000-4000-8000-000000000001',
    vehicleType: 'MOTOTAXI',
    plate: 'ABC12D',
    approvedBy: '00000000-0000-4000-8000-000000000002',
  },
};

describe('eventos de dominio', () => {
  it('DriverApproved v1 válido', () => {
    expect(DriverApprovedEventSchema.parse(event)).toEqual(event);
    expect(DomainEventSchema.parse(event).type).toBe('DriverApproved');
  });

  it('rechaza otra versión, otro tipo o datos incompletos', () => {
    expect(DriverApprovedEventSchema.safeParse({ ...event, version: 2 }).success).toBe(false);
    expect(DomainEventSchema.safeParse({ ...event, type: 'TripCreated' }).success).toBe(false);
    expect(
      DriverApprovedEventSchema.safeParse({ ...event, payload: { ...event.payload, userId: 'x' } })
        .success,
    ).toBe(false);
  });
});
