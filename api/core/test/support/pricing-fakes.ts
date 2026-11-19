// Dobles en memoria de los puertos del módulo pricing (HU-401, HU-402). Imitan al repositorio
// Drizzle: el actor debe ser ADMIN, sin cambios no hay historial, polígono validado.
import {
  pointInPolygon,
  type FareChange,
  type FareRule,
  type FareRuleUpdateBody,
  type Geofence,
  type GeofenceUpdateBody,
  type VehicleType,
} from '@panter/contracts';
import type {
  EditResult,
  FareChangeRepository,
  FareRuleRepository,
  GeofenceHit,
  GeofenceRepository,
} from '../../src/modules/pricing/application/ports';
import type { HistoryCursor } from '../../src/modules/pricing/domain/history-cursor';

const AT = '2026-11-18T12:00:00.000Z';

/** Semillas de 0005_m2_seed_fares.sql. */
export const SEED_RULES: FareRule[] = [
  {
    vehicleType: 'MOTOTAXI',
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
    updatedAt: AT,
    updatedBy: null,
  },
  {
    vehicleType: 'TAXI',
    pricingModel: 'METERED',
    baseFare: 6000,
    perKm: 1200,
    perMinute: 150,
    minimumFare: 6000,
    nightSurcharge: 2000,
    nightStartMinute: 1200,
    nightEndMinute: 300,
    roundTo: 100,
    active: true,
    updatedAt: AT,
    updatedBy: null,
  },
  {
    vehicleType: 'JEEP_4X4',
    pricingModel: 'METERED',
    baseFare: 15000,
    perKm: 2500,
    perMinute: 0,
    minimumFare: 30000,
    nightSurcharge: 5000,
    nightStartMinute: 1200,
    nightEndMinute: 300,
    roundTo: 1000,
    active: false,
    updatedAt: AT,
    updatedBy: null,
  },
];

export const AIRPORT_ID = '6c1f8a2e-0b7d-4f3a-9c51-1a2b3c4d5e01';
export const PERIPHERAL_ID = '6c1f8a2e-0b7d-4f3a-9c51-1a2b3c4d5e02';

export const SEED_GEOFENCES: Geofence[] = [
  {
    id: AIRPORT_ID,
    name: 'Aeropuerto Cananguchal (VGZ)',
    kind: 'AIRPORT',
    polygon: [
      [
        { lat: 0.972, lng: -76.612 },
        { lat: 0.972, lng: -76.598 },
        { lat: 0.986, lng: -76.598 },
        { lat: 0.986, lng: -76.612 },
      ],
    ],
    surcharge: 5000,
    appliesTo: ['MOTOTAXI', 'TAXI'],
    active: true,
  },
  {
    id: PERIPHERAL_ID,
    name: 'Zona periférica de Villagarzón',
    kind: 'PERIPHERAL',
    polygon: [
      [
        { lat: 1.0, lng: -76.65 },
        { lat: 1.0, lng: -76.585 },
        { lat: 1.06, lng: -76.585 },
        { lat: 1.06, lng: -76.65 },
      ],
      [
        { lat: 1.02, lng: -76.628 },
        { lat: 1.04, lng: -76.628 },
        { lat: 1.04, lng: -76.605 },
        { lat: 1.02, lng: -76.605 },
      ],
    ],
    surcharge: 1000,
    appliesTo: ['MOTOTAXI'],
    active: true,
  },
];

/** Almacén compartido por los tres repositorios en memoria. */
export class MemoryFareStore {
  readonly rules = new Map<VehicleType, FareRule>(
    SEED_RULES.map((r) => [r.vehicleType, structuredClone(r)]),
  );
  readonly geofences = new Map<string, Geofence>(
    SEED_GEOFENCES.map((g) => [g.id, structuredClone(g)]),
  );
  readonly changes: FareChange[] = [];
  /** Correos de los administradores activos, por id. */
  readonly admins = new Map<string, string>();
  /** Respuesta simulada de ST_IsValid para el próximo update de geocerca. */
  polygonReason: string | null = null;
  coveringCalls = 0;
  private seq = 0;

  record(entity: FareChange['entity'], key: string, before: object, after: object, actor: string) {
    this.seq++;
    this.changes.unshift({
      id: `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`,
      entity,
      entityKey: key,
      before: { ...before },
      after: { ...after },
      changedBy: this.admins.get(actor) ?? null,
      changedAt: new Date(Date.parse(AT) + this.seq * 1000).toISOString(),
    });
  }
}

const ruleSnapshot = ({ vehicleType: _v, updatedAt: _a, updatedBy: _b, ...rest }: FareRule) => rest;
const geofenceSnapshot = ({ id: _id, ...rest }: Geofence) => rest;

export class MemoryFareRuleRepository implements FareRuleRepository {
  constructor(readonly store: MemoryFareStore) {}
  async list() {
    return [...this.store.rules.values()];
  }
  async get(vehicleType: VehicleType) {
    return this.store.rules.get(vehicleType) ?? null;
  }
  async update(input: {
    vehicleType: VehicleType;
    actorId: string;
    rule: FareRuleUpdateBody;
  }): Promise<EditResult> {
    const actorIsAdmin = this.store.admins.has(input.actorId);
    const current = this.store.rules.get(input.vehicleType);
    if (!actorIsAdmin || !current) return { actorIsAdmin, exists: !!current, changed: false };
    const before = ruleSnapshot(current);
    if (JSON.stringify(before) === JSON.stringify({ ...before, ...input.rule })) {
      return { actorIsAdmin, exists: true, changed: false };
    }
    const next: FareRule = {
      ...current,
      ...input.rule,
      updatedAt: new Date().toISOString(),
      updatedBy: this.store.admins.get(input.actorId)!,
    };
    this.store.rules.set(input.vehicleType, next);
    this.store.record('FARE_RULE', input.vehicleType, before, ruleSnapshot(next), input.actorId);
    return { actorIsAdmin, exists: true, changed: true };
  }
}

export class MemoryGeofenceRepository implements GeofenceRepository {
  constructor(readonly store: MemoryFareStore) {}
  async list() {
    return [...this.store.geofences.values()];
  }
  async get(id: string) {
    return this.store.geofences.get(id) ?? null;
  }
  async findCovering(input: {
    origin: { lat: number; lng: number };
    destination: { lat: number; lng: number };
    vehicleType: VehicleType;
  }): Promise<GeofenceHit[]> {
    this.store.coveringCalls++;
    return [...this.store.geofences.values()]
      .filter(
        (g) =>
          g.active &&
          g.appliesTo.includes(input.vehicleType) &&
          (pointInPolygon(input.origin, g.polygon) || pointInPolygon(input.destination, g.polygon)),
      )
      .map(({ id, name, kind, surcharge }) => ({ id, name, kind, surcharge }));
  }
  async update(input: { id: string; actorId: string; geofence: GeofenceUpdateBody }) {
    const actorIsAdmin = this.store.admins.has(input.actorId);
    const current = this.store.geofences.get(input.id);
    const polygonValid = this.store.polygonReason === null;
    const base = {
      actorIsAdmin,
      exists: !!current,
      changed: false,
      polygonValid,
      polygonReason: this.store.polygonReason ?? 'Valid Geometry',
    };
    if (!actorIsAdmin || !current || !polygonValid) return base;
    const { polygon = current.polygon, ...rest } = input.geofence;
    const next: Geofence = { ...current, ...rest, polygon };
    if (JSON.stringify(next) === JSON.stringify(current)) return base;
    this.store.geofences.set(input.id, next);
    this.store.record(
      'GEOFENCE',
      input.id,
      geofenceSnapshot(current),
      geofenceSnapshot(next),
      input.actorId,
    );
    return { ...base, changed: true };
  }
}

export class MemoryFareChangeRepository implements FareChangeRepository {
  constructor(readonly store: MemoryFareStore) {}
  async list({ limit, after }: { limit: number; after?: HistoryCursor }) {
    const all = this.store.changes;
    const start = after ? all.findIndex((c) => c.id === after.id) + 1 : 0;
    const page = all.slice(start, start + limit);
    const last = page.at(-1);
    const more = start + limit < all.length;
    return {
      items: page,
      next: more && last ? { changedAt: last.changedAt, id: last.id } : null,
    };
  }
}

export function memoryPricing() {
  const store = new MemoryFareStore();
  return {
    store,
    rules: new MemoryFareRuleRepository(store),
    geofences: new MemoryGeofenceRepository(store),
    changes: new MemoryFareChangeRepository(store),
  };
}
