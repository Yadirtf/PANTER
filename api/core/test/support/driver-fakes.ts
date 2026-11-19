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
  DriverReviewRepository,
  ListDriversInput,
  NewDocumentInput,
  StatusChangeInput,
  ResubmitResult,
  UploadUseLedger,
} from '../../src/modules/drivers/application/ports';
import type {
  AdminDriverRecord,
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
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    const bytes = o.bytes;
    return {
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      }),
      contentType: o.meta.contentType,
      size: bytes.byteLength,
    };
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

interface Account {
  email: string;
  fullName: string | null;
  phone: string | null;
  admin: boolean;
  active: boolean;
  roles: string[];
}

/**
 * Doble del puerto DriverReviewRepository sobre los datos de un MemoryDriverRepository. Imita
 * la sentencia única: actor ADMIN activo, estado de origen permitido y, al aprobar, los cinco
 * documentos APPROVED; otorga DRIVER y audita solo si no lo tenía.
 */
export class MemoryDriverReviewRepository implements DriverReviewRepository {
  readonly accounts = new Map<string, Account>();
  readonly audit: { actorId: string; userId: string; role: string }[] = [];

  constructor(readonly drivers: MemoryDriverRepository) {}

  account(id: string, email: string, over: Partial<Account> = {}) {
    const acc: Account = {
      email,
      fullName: null,
      phone: null,
      admin: false,
      active: true,
      roles: ['PASSENGER'],
      ...over,
    };
    this.accounts.set(id, acc);
    return acc;
  }

  private record(id: string): AdminDriverRecord | null {
    const profile = this.drivers.profiles.get(id);
    if (!profile) return null;
    const acc = this.accounts.get(id);
    return {
      profile: structuredClone(profile),
      documents: [...this.drivers.documents.values()]
        .filter((d) => d.userId === id)
        .map((d) => ({ ...d })),
      email: acc?.email ?? `${id}@panter.test`,
      fullName: acc?.fullName ?? null,
      phone: acc?.phone ?? null,
      reviewedByEmail: profile.reviewedBy
        ? (this.accounts.get(profile.reviewedBy)?.email ?? null)
        : null,
    };
  }

  async list({ status, limit, after }: ListDriversInput) {
    const micros = (iso: string) => iso.replace('Z', '000Z');
    const sorted = [...this.drivers.profiles.values()]
      .filter((p) => !status || p.verificationStatus === status)
      .sort((a, b) => a.appliedAt.localeCompare(b.appliedAt) || a.userId.localeCompare(b.userId))
      .filter(
        (p) =>
          !after ||
          micros(p.appliedAt) > after.appliedAt ||
          (micros(p.appliedAt) === after.appliedAt && p.userId > after.userId),
      );
    const page = sorted.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((p) => this.record(p.userId)!),
      next:
        sorted.length > limit && last
          ? { appliedAt: micros(last.appliedAt), userId: last.userId }
          : null,
    };
  }

  async find(id: string) {
    return this.record(id);
  }

  private actorOk(actorId: string) {
    const a = this.accounts.get(actorId);
    return !!a && a.admin && a.active;
  }

  async reviewDocument(input: Parameters<DriverReviewRepository['reviewDocument']>[0]) {
    const actorIsAdmin = this.actorOk(input.actorId);
    const p = this.drivers.profiles.get(input.userId);
    const doc = this.drivers.documents.get(`${input.userId}:${input.type}`);
    let changed = false;
    if (actorIsAdmin && p && doc && input.profileFrom.includes(p.verificationStatus)) {
      Object.assign(doc, {
        status: input.status,
        rejectionReason: input.reason,
        reviewedAt: this.drivers.now(),
        reviewedBy: input.actorId,
      });
      changed = true;
    }
    return { actorIsAdmin, changed };
  }

  async approve(input: Parameters<DriverReviewRepository['approve']>[0]) {
    const actorIsAdmin = this.actorOk(input.actorId);
    const p = this.drivers.profiles.get(input.userId);
    const approved = [...this.drivers.documents.values()].filter(
      (d) => d.userId === input.userId && d.status === 'APPROVED',
    ).length;
    let changed = false;
    if (actorIsAdmin && p && input.from.includes(p.verificationStatus) && approved === 5) {
      Object.assign(p, {
        verificationStatus: 'APPROVED',
        rejectionReason: null,
        reviewedAt: this.drivers.now(),
        reviewedBy: input.actorId,
      });
      const acc = this.accounts.get(input.userId);
      if (acc && !acc.roles.includes('DRIVER')) {
        acc.roles.push('DRIVER');
        this.audit.push({ actorId: input.actorId, userId: input.userId, role: 'DRIVER' });
      }
      changed = true;
    }
    return { actorIsAdmin, changed };
  }

  async changeStatus(input: StatusChangeInput) {
    const actorIsAdmin = this.actorOk(input.actorId);
    const p = this.drivers.profiles.get(input.userId);
    let changed = false;
    if (actorIsAdmin && p && input.from.includes(p.verificationStatus)) {
      Object.assign(p, {
        verificationStatus: input.to,
        rejectionReason: input.reason,
        reviewedAt: this.drivers.now(),
        reviewedBy: input.actorId,
        ...(input.setOffline ? { availability: 'OFFLINE' } : {}),
      });
      changed = true;
    }
    return { actorIsAdmin, changed };
  }
}

/** Documento sembrado en un estado dado. */
export function seedDocument(
  repo: MemoryDriverRepository,
  id: string,
  type: DriverDocumentRecord['type'],
  status: DriverDocumentRecord['status'] = 'SUBMITTED',
  r2Key = `drivers/${id}/${type}/11111111-2222-4333-8444-555555555555`,
) {
  const doc: DriverDocumentRecord = {
    userId: id,
    type,
    r2Key,
    contentType: 'image/jpeg',
    sizeBytes: 12,
    status,
    rejectionReason: status === 'REJECTED' ? 'La foto está borrosa' : null,
    uploadedAt: repo.now(),
    reviewedAt: null,
    reviewedBy: null,
  };
  repo.documents.set(`${id}:${type}`, doc);
  return doc;
}
