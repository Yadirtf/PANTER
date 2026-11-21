// Dobles en memoria de los puertos del módulo catalog (E15). Imitan al repositorio Drizzle: el
// actor debe ser ADMIN en la "base de datos", nombre único por tipo sin tildes, ST_IsValid
// simulado, historial solo con cambios reales y el de menor área gana en `locate`.
import {
  pointInPolygon,
  type Area,
  type CatalogChange,
  type LatLng,
  type PolygonRings,
} from '@panter/contracts';
import type {
  AreaDraft,
  AreaImportItem,
  AreaListFilter,
  AreaPatch,
  AreaRepository,
  AreaWriteResult,
  CatalogChangeRepository,
  ImportCheck,
} from '../../src/modules/catalog/application/ports';
import type { HistoryCursor } from '../../src/modules/catalog/domain/history-cursor';

export const AT = '2026-11-20T15:00:00.000Z';

/** Barrio Centro de Villagarzón (rectángulo aproximado alrededor del parque principal). */
export const CENTRO_POLYGON: LatLng[][] = [
  [
    { lat: 1.025, lng: -76.621 },
    { lat: 1.025, lng: -76.611 },
    { lat: 1.034, lng: -76.611 },
    { lat: 1.034, lng: -76.621 },
  ],
];

/** Vereda que rodea el casco urbano. */
export const VEREDA_POLYGON: LatLng[][] = [
  [
    { lat: 1.0, lng: -76.66 },
    { lat: 1.0, lng: -76.59 },
    { lat: 1.06, lng: -76.59 },
    { lat: 1.06, lng: -76.66 },
  ],
];

/** Moño (bordes cruzados): el doble lo trata como ST_IsValid = false. */
export const BOWTIE_POLYGON: LatLng[][] = [
  [
    { lat: 1.01, lng: -76.62 },
    { lat: 1.02, lng: -76.61 },
    { lat: 1.01, lng: -76.61 },
    { lat: 1.02, lng: -76.62 },
  ],
];

const key = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();

const sameShape = (a: PolygonRings, b: PolygonRings) => JSON.stringify(a) === JSON.stringify(b);

/** Área aproximada en grados² (suficiente para ordenar en el doble). */
function area(polygon: PolygonRings): number {
  const ring = polygon[0]!;
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j]!.lng + ring[i]!.lng) * (ring[j]!.lat - ring[i]!.lat);
  }
  return Math.abs(sum / 2);
}

interface StoredArea extends Area {
  nameSearch: string;
}

export class MemoryCatalogChanges implements CatalogChangeRepository {
  readonly items: CatalogChange[] = [];
  private seq = 0;
  record(change: Omit<CatalogChange, 'id' | 'changedAt'>) {
    this.seq++;
    this.items.unshift({
      ...change,
      id: `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`,
      changedAt: new Date(Date.parse(AT) + this.seq * 1000).toISOString(),
    });
  }
  async list(input: {
    entity: CatalogChange['entity'];
    entityId: string;
    limit: number;
    after?: HistoryCursor;
  }) {
    let rows = this.items.filter((c) => c.entity === input.entity && c.entityId === input.entityId);
    if (input.after) {
      const idx = rows.findIndex((c) => c.id === input.after!.id);
      rows = rows.slice(idx + 1);
    }
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      items: page,
      next:
        rows.length > input.limit && last
          ? { changedAt: last.changedAt.replace('Z', '000Z'), id: last.id }
          : null,
    };
  }
}

export class MemoryAreaRepository implements AreaRepository {
  readonly rows = new Map<string, StoredArea>();
  readonly admins = new Set<string>();
  readonly emails = new Map<string, string>();
  readonly changes: MemoryCatalogChanges;
  /** Consultas de lectura reales (para comprobar la caché del isolate). */
  reads = 0;
  isValid: (polygon: PolygonRings) => boolean = (p) => !sameShape(p, BOWTIE_POLYGON);
  private seq = 0;

  constructor(changes = new MemoryCatalogChanges()) {
    this.changes = changes;
  }

  seed(name: string, kind: Area['kind'], polygon: LatLng[][], active = true): string {
    const id = `a0000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`;
    this.rows.set(id, {
      id,
      name,
      nameSearch: key(name),
      kind,
      active,
      polygon,
      source: null,
      center: polygon[0]![0]!,
      updatedAt: AT,
      updatedBy: null,
    });
    return id;
  }

  private snapshot(a: StoredArea) {
    return { name: a.name, kind: a.kind, polygon: a.polygon, source: a.source, active: a.active };
  }

  private taken(kind: Area['kind'], nameSearch: string, except?: string) {
    return [...this.rows.values()].some(
      (a) => a.kind === kind && a.nameSearch === nameSearch && a.id !== except,
    );
  }

  private base(actorId: string, polygon?: PolygonRings): AreaWriteResult {
    const valid = polygon ? this.isValid(polygon) : true;
    return {
      actorIsAdmin: this.admins.has(actorId),
      exists: true,
      polygonValid: valid,
      polygonReason: valid ? null : 'Self-intersection[-76.615 1.015]',
      nameTaken: false,
      id: null,
      changed: false,
    };
  }

  async list({ search, kind, includeInactive }: AreaListFilter) {
    this.reads++;
    return [...this.rows.values()]
      .filter((a) => (includeInactive || a.active) && (!kind || a.kind === kind))
      .filter((a) => a.nameSearch.includes(search ?? ''))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
      .map(({ id, name, kind: k, active }) => ({ id, name, kind: k, active }));
  }

  async get(id: string): Promise<Area | null> {
    this.reads++;
    const row = this.rows.get(id);
    if (!row) return null;
    const { nameSearch: _omit, ...rest } = row;
    void _omit;
    return { ...rest, polygon: rest.polygon.map((r) => [...r]) };
  }

  async locate(point: LatLng) {
    this.reads++;
    const hit = [...this.rows.values()]
      .filter((a) => a.active && pointInPolygon(point, a.polygon))
      .sort((a, b) => area(a.polygon) - area(b.polygon))[0];
    return hit ? { id: hit.id, name: hit.name, kind: hit.kind, active: hit.active } : null;
  }

  async create({ actorId, area: draft }: { actorId: string; area: AreaDraft }) {
    const result = this.base(actorId, draft.polygon);
    if (!result.actorIsAdmin || !result.polygonValid) return result;
    if (this.taken(draft.kind, draft.nameSearch)) return { ...result, nameTaken: true };
    const id = this.seed(
      draft.name,
      draft.kind,
      draft.polygon.map((r) => [...r]),
    );
    const row = this.rows.get(id)!;
    row.source = draft.source;
    row.updatedBy = this.emails.get(actorId) ?? null;
    this.changes.record({
      entity: 'AREA',
      entityId: id,
      action: 'CREATE',
      before: null,
      after: this.snapshot(row),
      changedBy: row.updatedBy,
    });
    return { ...result, id, changed: true };
  }

  async update({ id, actorId, patch }: { id: string; actorId: string; patch: AreaPatch }) {
    const result = { ...this.base(actorId, patch.polygon), id };
    const old = this.rows.get(id);
    if (!old) return { ...result, exists: false };
    if (!result.actorIsAdmin || !result.polygonValid) return result;
    const next: StoredArea = {
      ...old,
      ...(patch.name === undefined ? {} : { name: patch.name, nameSearch: patch.nameSearch! }),
      ...(patch.kind === undefined ? {} : { kind: patch.kind }),
      ...(patch.polygon === undefined ? {} : { polygon: patch.polygon.map((r) => [...r]) }),
      ...(patch.source === undefined ? {} : { source: patch.source }),
      ...(patch.active === undefined ? {} : { active: patch.active }),
    };
    if (this.taken(next.kind, next.nameSearch, id)) return { ...result, nameTaken: true };
    if (JSON.stringify(this.snapshot(old)) === JSON.stringify(this.snapshot(next))) return result;
    next.updatedBy = this.emails.get(actorId) ?? null;
    this.rows.set(id, next);
    this.changes.record({
      entity: 'AREA',
      entityId: id,
      action: 'UPDATE',
      before: this.snapshot(old),
      after: this.snapshot(next),
      changedBy: next.updatedBy,
    });
    return { ...result, changed: true };
  }

  async checkImport(items: (AreaImportItem & { index: number })[]): Promise<ImportCheck[]> {
    return items.map((i) => {
      const valid = this.isValid(i.polygon);
      return {
        index: i.index,
        valid,
        reason: valid ? null : 'Self-intersection[-76.615 1.015]',
        replacesExisting: this.taken(i.kind, i.nameSearch),
      };
    });
  }

  async importAreas({
    actorId,
    source,
    items,
  }: {
    actorId: string;
    source: string | null;
    items: AreaImportItem[];
  }) {
    if (!this.admins.has(actorId)) return { actorIsAdmin: false, saved: 0 };
    for (const item of items) {
      const existing = [...this.rows.values()].find(
        (a) => a.kind === item.kind && a.nameSearch === item.nameSearch,
      );
      const id =
        existing?.id ??
        this.seed(
          item.name,
          item.kind,
          item.polygon.map((r) => [...r]),
        );
      const before = existing ? this.snapshot(existing) : null;
      const row = this.rows.get(id)!;
      row.name = item.name;
      row.polygon = item.polygon.map((r) => [...r]);
      row.source = source ?? row.source;
      this.changes.record({
        entity: 'AREA',
        entityId: id,
        action: 'IMPORT',
        before,
        after: this.snapshot(row),
        changedBy: this.emails.get(actorId) ?? null,
      });
    }
    return { actorIsAdmin: true, saved: items.length };
  }
}
