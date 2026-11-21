import type {
  Area,
  AreaKind,
  AreaSummary,
  CatalogChange,
  LatLng,
  PolygonRings,
} from '@panter/contracts';
import type { HistoryCursor } from '../domain/history-cursor';

// --- Barrios y veredas (HU-308) ---

export interface AreaListFilter {
  /** `searchKey` del texto buscado (sin tildes ni mayúsculas); vacío = sin filtro. */
  search?: string;
  kind?: AreaKind;
  includeInactive: boolean;
}

/** Puerto de lectura de `areas` (público; la implementación puede ir en caché del isolate). */
export interface AreaReader {
  /** Sin polígono, ordenados por tipo y nombre. */
  list(filter: AreaListFilter): Promise<AreaSummary[]>;
  /** Con polígono y centro (`ST_PointOnSurface`); `updatedBy` es el correo de quien editó. */
  get(id: string): Promise<Area | null>;
  /**
   * Barrio o vereda activo que cubre el punto (`ST_Covers`, el borde cuenta como dentro). Si
   * varios se solapan, el de menor área (un barrio dentro de una vereda gana la vereda).
   */
  locate(point: LatLng): Promise<AreaSummary | null>;
}

export interface AreaDraft {
  name: string;
  /** `searchKey(name)` */
  nameSearch: string;
  kind: AreaKind;
  polygon: PolygonRings;
  source: string | null;
}

/** Cambios de una edición: lo que no viene se conserva. */
export interface AreaPatch {
  name?: string;
  nameSearch?: string;
  kind?: AreaKind;
  polygon?: PolygonRings;
  /** `undefined` conserva la fuente; `null` la borra. */
  source?: string | null;
  active?: boolean;
}

/**
 * Resultado de crear o editar, decidido en una sola sentencia (la misma que escribe el historial
 * y recalcula `places.area_id`):
 * - `actorIsAdmin`: quien edita sigue siendo ADMIN con la cuenta ACTIVE (manda la base de
 *   datos, no el token);
 * - `exists`: el barrio existe (en una creación, siempre true);
 * - `polygonValid` / `polygonReason`: `ST_IsValid` y `ST_IsValidReason`;
 * - `nameTaken`: ya hay otro del mismo tipo con ese nombre sin tildes;
 * - `id`: el barrio creado o editado, si se escribió;
 * - `changed`: hubo cambio real (sin cambios no se registra historial).
 */
export interface AreaWriteResult {
  actorIsAdmin: boolean;
  exists: boolean;
  polygonValid: boolean;
  polygonReason: string | null;
  nameTaken: boolean;
  id: string | null;
  changed: boolean;
}

/** Resultado de PostGIS para una feature de la importación. */
export interface ImportCheck {
  index: number;
  valid: boolean;
  reason: string | null;
  /** Ya existe uno con ese tipo y nombre: la importación lo reemplaza. */
  replacesExisting: boolean;
}

export interface AreaImportItem {
  name: string;
  nameSearch: string;
  kind: AreaKind;
  polygon: PolygonRings;
}

/** Puerto: `areas` en PostGIS. */
export interface AreaRepository extends AreaReader {
  create(input: { actorId: string; area: AreaDraft }): Promise<AreaWriteResult>;
  update(input: { id: string; actorId: string; patch: AreaPatch }): Promise<AreaWriteResult>;
  /** `ST_IsValid` y nombre existente de cada candidata, en una sola consulta. */
  checkImport(items: (AreaImportItem & { index: number })[]): Promise<ImportCheck[]>;
  /**
   * Upsert por (tipo, nombre sin tildes) en una sola sentencia (todo o nada), con `IMPORT` en
   * el historial y `places.area_id` recalculado. Conserva `active` de los que ya existían.
   */
  importAreas(input: {
    actorId: string;
    source: string | null;
    items: AreaImportItem[];
  }): Promise<{ actorIsAdmin: boolean; saved: number }>;
}

// --- Historial común ---

export type CatalogEntity = CatalogChange['entity'];

export interface CatalogChangesPage {
  items: CatalogChange[];
  next: HistoryCursor | null;
}

/** Puerto: historial inmutable (`catalog_changes`), del más reciente al más antiguo. */
export interface CatalogChangeRepository {
  list(input: {
    entity: CatalogEntity;
    entityId: string;
    limit: number;
    after?: HistoryCursor;
  }): Promise<CatalogChangesPage>;
}

/** Se llama tras un cambio real: invalida la caché del catálogo en este isolate. */
export type OnCatalogChange = () => void;
