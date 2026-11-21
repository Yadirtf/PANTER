import {
  isInServiceArea,
  searchKey,
  type Area,
  type AreaCreateBody,
  type AreaImportBody,
  type AreaImportResult,
  type AreaLocateResponse,
  type AreasQuery,
  type AreasResponse,
  type AreaUpdateBody,
  type LocateQuery,
} from '@panter/contracts';
import type { Actor } from '../../auth/domain/actor';
import { areaPolygonIssues } from '../domain/geometry';
import { invalidGeometryReason, parseAreaImport } from '../domain/geojson-import';
import { CatalogErrors } from './errors';
import type {
  AreaPatch,
  AreaReader,
  AreaRepository,
  AreaWriteResult,
  OnCatalogChange,
} from './ports';

/** Quien consulta una ruta pública: el ADMIN ve los desactivados y quién editó. */
export interface Viewer {
  isAdmin: boolean;
}

/** GET /areas */
export type ListAreas = (query: AreasQuery, viewer: Viewer) => Promise<AreasResponse>;

/**
 * Lista sin polígono (HU-308), con búsqueda sin tildes (`searchKey` sobre `name_search`) y
 * filtro por tipo. `includeInactive` es solo para ADMIN → 403 si no lo es.
 */
export function makeListAreas(deps: { areas: AreaReader }): ListAreas {
  return async ({ q, kind, includeInactive }, viewer) => {
    if (includeInactive && !viewer.isAdmin) throw CatalogErrors.forbidden();
    const search = q ? searchKey(q) : '';
    const items = await deps.areas.list({
      ...(search ? { search } : {}),
      ...(kind ? { kind } : {}),
      includeInactive,
    });
    return { items };
  };
}

/** GET /areas/:id */
export type GetArea = (id: string, viewer: Viewer) => Promise<Area>;

/**
 * Detalle con polígono y centro, para dibujar el croquis. Un desactivado solo lo ve el ADMIN
 * (los demás reciben 404) y el correo de quien editó tampoco sale en la vista pública.
 */
export function makeGetArea(deps: { areas: AreaReader }): GetArea {
  return async (id, viewer) => {
    const area = await deps.areas.get(id);
    if (!area || (!area.active && !viewer.isAdmin)) throw CatalogErrors.areaNotFound();
    return viewer.isAdmin ? area : { ...area, updatedBy: null };
  };
}

/** GET /areas/locate */
export type LocateArea = (query: LocateQuery) => Promise<AreaLocateResponse>;

/** Barrio o vereda que cubre el punto, o null. Fuera del área de servicio ni consulta. */
export function makeLocateArea(deps: { areas: AreaReader }): LocateArea {
  return async ({ lat, lng }) => {
    const point = { lat, lng };
    if (!isInServiceArea(point)) return { area: null };
    return { area: await deps.areas.locate(point) };
  };
}

function checkWrite(result: AreaWriteResult, kind: AreaPatch['kind'], name: string | undefined) {
  if (!result.actorIsAdmin) throw CatalogErrors.forbidden();
  if (!result.exists) throw CatalogErrors.areaNotFound();
  if (!result.polygonValid) {
    throw CatalogErrors.invalidPolygon(invalidGeometryReason(result.polygonReason), [
      { path: 'polygon', code: 'invalid_geometry', message: result.polygonReason ?? '' },
    ]);
  }
  if (result.nameTaken) throw CatalogErrors.areaNameTaken(kind ?? 'BARRIO', name ?? '');
}

function checkPolygon(polygon: AreaCreateBody['polygon'] | undefined) {
  if (!polygon) return;
  const issues = areaPolygonIssues(polygon);
  if (issues.length > 0) {
    throw CatalogErrors.invalidPolygon(
      [...new Set(issues.map((i) => i.message))].join(' '),
      issues,
    );
  }
}

function nameSearchOf(name: string): string {
  const key = searchKey(name);
  if (!key) throw CatalogErrors.invalidName();
  return key;
}

/** POST /admin/areas */
export type CreateArea = (actor: Actor, body: AreaCreateBody) => Promise<Area>;

/**
 * Crea un barrio o vereda (HU-308):
 * - polígono dentro de SERVICE_AREA con anillos de ≥ 3 vértices y válido para PostGIS
 *   (`ST_IsValid`) → si no, 422 `INVALID_POLYGON` con el motivo en `details.reason`;
 * - nombre único por tipo sin tildes → 409 `AREA_NAME_TAKEN`;
 * - quien crea ya no es ADMIN en la base de datos → 403.
 * El historial (CREATE) y el recálculo de `places.area_id` van en la misma sentencia.
 */
export function makeCreateArea(deps: {
  areas: AreaRepository;
  onChange?: OnCatalogChange;
}): CreateArea {
  return async (actor, body) => {
    checkPolygon(body.polygon);
    const nameSearch = nameSearchOf(body.name);
    const result = await deps.areas.create({
      actorId: actor.userId,
      area: {
        name: body.name,
        nameSearch,
        kind: body.kind,
        polygon: body.polygon,
        source: body.source?.trim() || null,
      },
    });
    checkWrite(result, body.kind, body.name);
    deps.onChange?.();
    const saved = result.id ? await deps.areas.get(result.id) : null;
    if (!saved) throw CatalogErrors.areaNotFound();
    return saved;
  };
}

/** PATCH /admin/areas/:id */
export type UpdateArea = (actor: Actor, id: string, body: AreaUpdateBody) => Promise<Area>;

/**
 * Edita nombre, tipo, polígono, fuente o estado (desactivar = `active: false`). Mismas
 * validaciones que crear; sin cambios reales no se registra nada. Si cambia el polígono o el
 * estado, los lugares afectados recalculan su barrio en la misma sentencia.
 */
export function makeUpdateArea(deps: {
  areas: AreaRepository;
  onChange?: OnCatalogChange;
}): UpdateArea {
  return async (actor, id, body) => {
    checkPolygon(body.polygon);
    const patch: AreaPatch = {
      ...(body.name === undefined ? {} : { name: body.name, nameSearch: nameSearchOf(body.name) }),
      ...(body.kind === undefined ? {} : { kind: body.kind }),
      ...(body.polygon === undefined ? {} : { polygon: body.polygon }),
      ...(body.source === undefined ? {} : { source: body.source?.trim() || null }),
      ...(body.active === undefined ? {} : { active: body.active }),
    };
    const result = await deps.areas.update({ id, actorId: actor.userId, patch });
    const current = result.nameTaken ? await deps.areas.get(id) : null;
    checkWrite(result, body.kind ?? current?.kind, body.name ?? current?.name);
    if (result.changed) deps.onChange?.();
    const saved = await deps.areas.get(id);
    if (!saved) throw CatalogErrors.areaNotFound();
    return saved;
  };
}

/** POST /admin/areas/import */
export type ImportAreas = (actor: Actor, body: AreaImportBody) => Promise<AreaImportResult>;

/**
 * Importación GeoJSON (HU-308):
 * 1. `parseAreaImport`: geometría, nombre, tipo, área de servicio y repetidos en el archivo;
 * 2. PostGIS, en una sola consulta: `ST_IsValid` (con `ST_IsValidReason`) y si ya existe;
 * 3. con `dryRun` (por defecto) solo responde la vista previa; sin `dryRun` guarda las
 *    válidas con un upsert por (tipo, nombre) en una sola sentencia, con IMPORT en el
 *    historial. Las rechazadas no se guardan y siguen en `errors`.
 */
export function makeImportAreas(deps: {
  areas: AreaRepository;
  onChange?: OnCatalogChange;
}): ImportAreas {
  return async (actor, body) => {
    const parsed = parseAreaImport(body);
    const checks =
      parsed.candidates.length > 0
        ? await deps.areas.checkImport(
            parsed.candidates.map(({ index, name, nameSearch, kind, polygon }) => ({
              index,
              name,
              nameSearch,
              kind,
              polygon,
            })),
          )
        : [];
    const byIndex = new Map(checks.map((c) => [c.index, c]));
    const errors = [...parsed.errors];
    const valid: AreaImportResult['valid'] = [];
    for (const c of parsed.candidates) {
      const check = byIndex.get(c.index);
      if (!check?.valid) {
        errors.push({
          index: c.index,
          name: c.name,
          reason: invalidGeometryReason(check?.reason ?? null),
        });
        continue;
      }
      valid.push({
        index: c.index,
        name: c.name,
        kind: c.kind,
        polygon: c.polygon,
        replacesExisting: check.replacesExisting,
      });
    }
    errors.sort((a, b) => a.index - b.index);

    let saved = 0;
    if (!body.dryRun && valid.length > 0) {
      const result = await deps.areas.importAreas({
        actorId: actor.userId,
        source: body.source?.trim() || null,
        items: valid.map((v) => ({
          name: v.name,
          nameSearch: searchKey(v.name),
          kind: v.kind,
          polygon: v.polygon,
        })),
      });
      if (!result.actorIsAdmin) throw CatalogErrors.forbidden();
      saved = result.saved;
      deps.onChange?.();
    }
    return { dryRun: body.dryRun, valid, errors, saved };
  };
}
