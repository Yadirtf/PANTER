// Dobles en memoria del módulo drivers (E2). Imitan las reglas de los repositorios Drizzle:
// placa única, perfil único por cuenta y cambios condicionados al estado de origen.
import {
  DriverAvailability,
  DriverVerificationStatus,
  type DriverVerificationStatus as Status,
} from '@panter/contracts';
import type {
  CreateProfileResult,
  DriverRepository,
  ResubmitResult,
} from '../../src/modules/drivers/application/ports';
import type {
  DriverDocumentRecord,
  DriverProfileRecord,
  Vehicle,
} from '../../src/modules/drivers/domain/driver-profile';

export const sampleVehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  vehicleType: 'MOTOTAXI',
  plate: 'ABC12D',
  brand: 'Bajaj',
  model: 'Boxer CT100',
  color: 'Rojo',
  year: 2022,
  ...over,
});

export const userId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export class MemoryDriverRepository implements DriverRepository {
  readonly profiles = new Map<string, DriverProfileRecord>();
  /** Clave `${userId}:${type}`. */
  readonly documents = new Map<string, DriverDocumentRecord>();
  readonly offline: string[] = [];
  private tick = 0;

  now(): string {
    this.tick++;
    return new Date(Date.UTC(2026, 10, 18, 12, 0, this.tick)).toISOString();
  }

  /** Siembra un perfil en el estado pedido. */
  seed(id: string, status: Status = DriverVerificationStatus.PENDING, vehicle = sampleVehicle()) {
    const profile: DriverProfileRecord = {
      userId: id,
      vehicle,
      verificationStatus: status,
      availability: DriverAvailability.OFFLINE,
      rejectionReason: null,
      appliedAt: this.now(),
      reviewedAt: null,
      reviewedBy: null,
    };
    this.profiles.set(id, profile);
    return profile;
  }

  private plateTaken(id: string, plate: string) {
    return [...this.profiles.values()].some((p) => p.userId !== id && p.vehicle.plate === plate);
  }

  async findProfile(id: string) {
    const p = this.profiles.get(id);
    return p ? structuredClone(p) : null;
  }

  async listDocuments(id: string) {
    return [...this.documents.values()].filter((d) => d.userId === id).map((d) => ({ ...d }));
  }

  async create(id: string, vehicle: Vehicle): Promise<CreateProfileResult> {
    if (this.profiles.has(id)) return { ok: false, reason: 'exists' };
    if (this.plateTaken(id, vehicle.plate)) return { ok: false, reason: 'plate_taken' };
    return { ok: true, profile: structuredClone(this.seed(id, 'PENDING', vehicle)) };
  }

  async resubmit(id: string, vehicle: Vehicle): Promise<ResubmitResult> {
    const p = this.profiles.get(id);
    if (!p || p.verificationStatus !== 'REJECTED') return { ok: false, reason: 'not_rejected' };
    if (this.plateTaken(id, vehicle.plate)) return { ok: false, reason: 'plate_taken' };
    Object.assign(p, {
      vehicle,
      verificationStatus: 'PENDING',
      rejectionReason: null,
      reviewedAt: null,
      reviewedBy: null,
      appliedAt: this.now(),
    });
    return { ok: true, profile: structuredClone(p) };
  }

  async setUnavailable(id: string) {
    const p = this.profiles.get(id);
    if (p) p.availability = DriverAvailability.OFFLINE;
    this.offline.push(id);
  }

  async canUseDriverMode(id: string) {
    return this.profiles.get(id)?.verificationStatus === 'APPROVED';
  }
}
