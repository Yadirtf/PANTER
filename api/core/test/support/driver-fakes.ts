// Dobles en memoria del módulo drivers (E2). Imitan las reglas de los repositorios Drizzle:
// placa única, perfil único por cuenta y cambios condicionados al estado de origen.
import {
  DriverAvailability,
  DriverVerificationStatus,
  type DriverVerificationStatus as Status,
} from '@panter/contracts';
import type {
  CreateProfileResult,
  DocumentStorage,
  DriverRepository,
  NewDocumentInput,
  ResubmitResult,
  UploadUseLedger,
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

  async upsertDocument(input: NewDocumentInput) {
    const p = this.profiles.get(input.userId);
    if (!p || !['PENDING', 'REJECTED'].includes(p.verificationStatus)) return null;
    const doc: DriverDocumentRecord = {
      ...input,
      status: 'SUBMITTED',
      rejectionReason: null,
      uploadedAt: this.now(),
      reviewedAt: null,
      reviewedBy: null,
    };
    this.documents.set(`${input.userId}:${input.type}`, doc);
    return { ...doc };
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

export class MemoryDocumentStorage implements DocumentStorage {
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; meta: { contentType: string; userId: string; type: string } }
  >();
  readonly deleted: string[] = [];
  async put(
    key: string,
    bytes: Uint8Array,
    meta: { contentType: string; userId: string; type: string },
  ) {
    this.objects.set(key, { bytes, meta });
  }
  async delete(key: string) {
    this.objects.delete(key);
    this.deleted.push(key);
  }
}

export class MemoryUploadLedger implements UploadUseLedger {
  readonly used = new Map<string, number>();
  async isUsed(key: string) {
    return this.used.has(key);
  }
  async markUsed(key: string, ttl: number) {
    this.used.set(key, ttl);
  }
}

/** Imágenes mínimas con sus magic bytes reales. */
export const IMAGES = {
  'image/jpeg': () =>
    new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]),
  'image/png': () =>
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48]),
  'image/webp': () =>
    new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]),
} as const;

/** Stream que entrega `chunks` (para simular subidas por partes o Content-Length falso). */
export function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}
