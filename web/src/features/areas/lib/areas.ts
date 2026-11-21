import {
  AREA_KIND_LABELS,
  AreaCreateBodySchema,
  AreaKind,
  isInServiceArea,
  searchKey,
  type Area,
  type AreaCreateBody,
  type AreaSummary,
  type AreaUpdateBody,
  type LatLng,
  type PolygonRings,
} from '@panter/contracts';
import type { FieldErrors, ParseResult } from '@/features/fares/lib/fares';
import type { FieldChange } from '@/features/fares/lib/history';
import { catalogDiff } from '@/features/catalog/lib/catalog-history';
import {
  describePolygon,
  describePolygonChange,
  samePolygon,
  toPolygonPayload,
  type EditableRings,
} from '@/features/geo-editor/lib/polygon-edit';
import { shapesAt, type MapShape } from '@/features/geo-editor/lib/polygon-map';
import { overlapping } from '@/features/geo-editor/lib/polygon-validation';

/** Barrios y veredas en la web (HU-309): lista, formulario, mapa y "Probar un punto". */

export const ADMIN_AREAS_PATH = '/admin/barrios';

export const AREA_KINDS: readonly AreaKind[] = [AreaKind.BARRIO, AreaKind.VEREDA];

/** Color de cada tipo en el mapa y en la leyenda. */
export const AREA_KIND_COLOR: Record<AreaKind, string> = {
  [AreaKind.BARRIO]: '#7c3aed',
  [AreaKind.VEREDA]: '#b45309',
};

/** Id del polígono que se está dibujando (aún no existe en la API). */
export const NEW_AREA_ID = 'nuevo';

/** "Barrio Centro", "Vereda Alto Sinaí". */
export function areaLabel(area: Pick<AreaSummary, 'name' | 'kind'>): string {
  return `${AREA_KIND_LABELS[area.kind]} ${area.name}`;
}

export interface AreaFilter {
  q: string;
  kind: AreaKind | '';
}

/**
 * Filtra por tipo y por nombre sin tildes ni mayúsculas (searchKey de contracts): "pozo" encuentra
 * "Pozo Azul" y "san jose" encuentra "San José". Orden: activos primero y luego por nombre.
 */
export function filterAreas<T extends AreaSummary>(areas: readonly T[], filter: AreaFilter): T[] {
  const words = searchKey(filter.q).split(' ').filter(Boolean);
  return areas
    .filter((area) => !filter.kind || area.kind === filter.kind)
    .filter((area) => {
      const key = searchKey(area.name);
      return words.every((word) => key.includes(word));
    })
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
    );
}

export function areaShape(area: AreaSummary & { polygon: PolygonRings }): MapShape {
  return {
    id: area.id,
    name: area.name,
    kind: area.kind,
    active: area.active,
    color: AREA_KIND_COLOR[area.kind],
    polygon: area.polygon,
  };
}

// --- Formulario (nombre, tipo, fuente) ---

export interface AreaForm {
  name: string;
  kind: AreaKind;
  source: string;
}
export type AreaFormField = keyof AreaForm;

export const AREA_FIELD_ERROR: Record<AreaFormField, string> = {
  name: 'Escribe un nombre de 2 a 80 caracteres.',
  kind: 'Elige si es barrio o vereda.',
  source: 'La fuente puede tener hasta 200 caracteres.',
};

export const DEFAULT_DRAWN_SOURCE = 'Dibujado por ADMIN en /admin/barrios';

export function emptyAreaForm(): AreaForm {
  return { name: '', kind: AreaKind.BARRIO, source: DEFAULT_DRAWN_SOURCE };
}

export function areaToForm(area: Pick<Area, 'name' | 'kind' | 'source'>): AreaForm {
  return { name: area.name, kind: area.kind, source: area.source ?? '' };
}

export type AreaFields = Pick<AreaCreateBody, 'name' | 'kind' | 'source'>;

const FieldsSchema = AreaCreateBodySchema.pick({ name: true, kind: true, source: true });

/** Valida el formulario con el esquema de contracts; la fuente vacía se guarda como null. */
export function formToAreaFields(form: AreaForm): ParseResult<AreaFields, AreaFormField> {
  const parsed = FieldsSchema.safeParse({
    name: form.name,
    kind: form.kind,
    source: form.source.trim() ? form.source : null,
  });
  if (parsed.success) return { ok: true, body: parsed.data };
  const errors: FieldErrors<AreaFormField> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as AreaFormField;
    if (field in AREA_FIELD_ERROR && !errors[field]) errors[field] = AREA_FIELD_ERROR[field];
  }
  return { ok: false, errors };
}

/** POST /admin/areas: campos y el polígono dibujado (anillos cerrados). */
export function areaCreateBody(fields: AreaFields, rings: EditableRings): AreaCreateBody {
  return { ...fields, source: fields.source ?? null, polygon: toPolygonPayload(rings) };
}

/**
 * PATCH /admin/areas/:id: solo lo que cambió. El polígono va solo si se editó (si no, la API
 * conserva el actual). `{}` si no hay cambios.
 */
export function areaUpdateBody(
  saved: Pick<Area, 'name' | 'kind' | 'source'> & { polygon: PolygonRings | null },
  fields: AreaFields,
  editedRings: EditableRings | null,
): AreaUpdateBody {
  const body: AreaUpdateBody = {};
  if (fields.name !== saved.name) body.name = fields.name;
  if (fields.kind !== saved.kind) body.kind = fields.kind;
  if ((fields.source ?? null) !== (saved.source ?? null)) body.source = fields.source ?? null;
  if (editedRings && (!saved.polygon || !samePolygon(saved.polygon, editedRings))) {
    body.polygon = toPolygonPayload(editedRings);
  }
  return body;
}

/** Diff legible para la confirmación ("Nombre: Centro → Centro histórico"). */
export function areaChanges(
  saved:
    (Pick<Area, 'name' | 'kind' | 'source' | 'active'> & { polygon: PolygonRings | null }) | null,
  body: AreaUpdateBody | AreaCreateBody,
): FieldChange[] {
  if (!saved) {
    const { polygon, ...fields } = body as AreaCreateBody;
    const changes = catalogDiff(null, { ...fields, active: true });
    changes.push({
      field: 'polygon',
      label: 'Polígono',
      before: '—',
      after: describePolygon(polygon),
    });
    return changes;
  }
  const { polygon, ...fields } = body;
  const before = { name: saved.name, kind: saved.kind, source: saved.source, active: saved.active };
  const changes = catalogDiff(before, { ...before, ...fields });
  if (polygon) {
    changes.push({
      field: 'polygon',
      label: 'Polígono',
      ...(saved.polygon
        ? describePolygonChange(saved.polygon, polygon)
        : { before: '—', after: describePolygon(polygon) }),
    });
  }
  return changes;
}

// --- Solapamiento (advertencia) y "Probar un punto" ---

/**
 * Advertencias por solapamiento con otros barrios o veredas ACTIVOS. No bloquean: el límite
 * oficial puede tener zonas compartidas, pero conviene revisarlo.
 */
export function overlapWarnings(
  polygon: PolygonRings,
  others: readonly (AreaSummary & { polygon: PolygonRings })[],
  selfId: string | null,
): string[] {
  const candidates = others.filter((o) => o.active && o.id !== selfId);
  return overlapping(polygon, candidates).map(
    (o) => `Se solapa con ${areaLabel(o)}. Puedes guardarlo igual, pero revisa los límites.`,
  );
}

export interface PointTest {
  inServiceArea: boolean;
  /** Activos que cubren el punto (lo que respondería GET /areas/locate). */
  active: AreaSummary[];
  /** Desactivados que también lo cubren. */
  inactive: AreaSummary[];
}

export function testPoint(
  point: LatLng,
  areas: readonly (AreaSummary & { polygon: PolygonRings })[],
): PointTest {
  const hits = shapesAt(point, areas);
  return {
    inServiceArea: isInServiceArea(point),
    active: hits.filter((a) => a.active),
    inactive: hits.filter((a) => !a.active),
  };
}

/** Texto del resultado de "Probar un punto". */
export function pointTestMessage(result: PointTest): string {
  if (!result.inServiceArea) return 'Este punto está fuera del área de servicio de PANTER.';
  const [first, ...rest] = result.active;
  if (!first) {
    return result.inactive.length > 0
      ? `Ningún barrio o vereda activo cubre este punto (solo ${result.inactive.map(areaLabel).join(', ')}, desactivado).`
      : 'Ningún barrio o vereda cubre este punto.';
  }
  const main = `Este punto está en ${areaLabel(first)}.`;
  return rest.length > 0
    ? `${main} También lo cubre ${rest.map(areaLabel).join(', ')}: revisa el solapamiento.`
    : main;
}
