'use client';

import {
  AREA_KIND_LABELS,
  type Area,
  type AreaCreateBody,
  type AreaKind,
  type AreaSummary,
  type AreaUpdateBody,
  type LatLng,
  type PolygonRings,
} from '@panter/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { handleAdminFailure } from '@/features/admin/lib/admin-failure';
import {
  createArea,
  fetchAreaDetails,
  fetchAreaHistory,
  updateArea,
} from '@/features/catalog/api/catalog-client';
import { CatalogHistory } from '@/features/catalog/components/catalog-history';
import { catalogFailureMessage } from '@/features/catalog/lib/messages';
import { AREA_DETAILS_MAX_IDS } from '@/features/catalog/lib/limits';
import { inputClass } from '@/features/fares/components/form-fields';
import type { FieldErrors } from '@/features/fares/lib/fares';
import type { FieldChange } from '@/features/fares/lib/history';
import { FitBounds, type FitTarget } from '@/features/geo-editor/components/fit-bounds';
import {
  PolygonLayers,
  type PolygonEditing,
} from '@/features/geo-editor/components/polygon-layers';
import { PolygonPanel } from '@/features/geo-editor/components/polygon-panel';
import {
  addDrawVertex,
  canCloseDrawing,
  closeDrawing,
  deleteVertex,
  describePolygon,
  insertMidpoint,
  moveVertex,
  toEditable,
  undoDrawVertex,
  type DrawDraft,
  type EditableRings,
  type VertexRef,
} from '@/features/geo-editor/lib/polygon-edit';
import { formatLatLng, type MapShape } from '@/features/geo-editor/lib/polygon-map';
import { polygonIssues } from '@/features/geo-editor/lib/polygon-validation';
import { PanterMap } from '@/features/map/components/panter-map';
import { toApiError } from '@/shared/api/errors';
import {
  ADMIN_AREAS_PATH,
  AREA_KIND_COLOR,
  AREA_KINDS,
  areaChanges,
  areaCreateBody,
  areaLabel,
  areaShape,
  areaToForm,
  areaUpdateBody,
  emptyAreaForm,
  filterAreas,
  formToAreaFields,
  NEW_AREA_ID,
  overlapWarnings,
  pointTestMessage,
  testPoint as runPointTest,
  type AreaFilter,
  type AreaForm,
  type AreaFormField,
} from '../lib/areas';
import { AreaFormFields, ConfirmChanges } from './area-form';
import { AreaImport } from './area-import';

export const AREAS_MAP_HELP =
  'Con «Dibujar barrio o vereda» haces clic en el mapa para poner los vértices y cierras el polígono con un clic en el primero. «Editar» cambia el polígono de uno existente y «Probar un punto» dice qué barrio o vereda cubre un lugar.';
export const DRAW_HELP =
  'Haz clic en el mapa para agregar cada vértice. Para cerrar el polígono haz clic en el primer vértice (el amarillo) o pulsa «Cerrar polígono».';
export const TEST_POINT_HELP = 'Haz clic en el mapa para ver qué barrio o vereda cubre ese punto.';

type Mode = 'idle' | 'draw' | 'test' | 'import';

type AreaWithPolygon = AreaSummary & { polygon: PolygonRings };

interface Pending {
  target: string;
  title: string;
  body: AreaCreateBody | AreaUpdateBody;
  changes: FieldChange[];
  warnings: string[];
}

/** Barrios y veredas (HU-309): lista filtrable, mapa con los polígonos y editor. */
export function AreasEditor({ areas }: { areas: readonly AreaSummary[] }) {
  const router = useRouter();
  const [details, setDetails] = useState<Record<string, Area>>({});
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<AreaFilter>({ q: '', kind: '' });
  const [mode, setMode] = useState<Mode>('idle');
  const [draft, setDraft] = useState<DrawDraft | null>(null);
  const [editing, setEditing] = useState<PolygonEditing | null>(null);
  const [form, setForm] = useState<AreaForm | null>(null);
  const [errors, setErrors] = useState<FieldErrors<AreaFormField>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mapMessage, setMapMessage] = useState<string | null>(null);
  const [point, setPoint] = useState<LatLng | null>(null);
  const [preview, setPreview] = useState<MapShape[]>([]);
  const [fit, setFit] = useState<FitTarget | null>(null);

  // Polígonos: GET /areas no los trae; se piden por lotes al BFF (GET /areas/:id de cada uno).
  const missingIds = useMemo(
    () => areas.map((a) => a.id).filter((id) => !details[id]),
    [areas, details],
  );
  const missingKey = missingIds.join(',');
  useEffect(() => {
    if (!missingKey) return;
    let cancelled = false;
    const ids = missingKey.split(',');
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += AREA_DETAILS_MAX_IDS) {
      batches.push(ids.slice(i, i + AREA_DETAILS_MAX_IDS));
    }
    setDetailsError(null);
    void (async () => {
      for (const batch of batches) {
        try {
          const page = await fetchAreaDetails(batch);
          if (cancelled) return;
          setDetails((current) => ({
            ...current,
            ...Object.fromEntries(page.items.map((area) => [area.id, area])),
          }));
        } catch (failure) {
          if (cancelled) return;
          handleAdminFailure(
            failure,
            ADMIN_AREAS_PATH,
            () =>
              `No pudimos cargar los polígonos del mapa. ${catalogFailureMessage(toApiError(failure))}`,
            setDetailsError,
          );
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `reload` vuelve a intentar tras un error.
  }, [missingKey, reload]);

  const withPolygon: AreaWithPolygon[] = areas.flatMap((area) => {
    const detail = details[area.id];
    return detail ? [{ ...area, polygon: detail.polygon }] : [];
  });

  const editingId = editing?.id ?? null;
  const shapes: MapShape[] = withPolygon.map(areaShape);
  if (editing && editing.id === NEW_AREA_ID && form) {
    shapes.push({
      id: NEW_AREA_ID,
      name: form.name.trim() || 'Nuevo',
      kind: form.kind,
      active: true,
      color: AREA_KIND_COLOR[form.kind],
      polygon: editing.rings,
    });
  }
  const shownNow = withPolygon.map((a) =>
    a.id === editingId && editing ? { ...a, polygon: editing.rings as PolygonRings } : a,
  );
  const listed = filterAreas(areas, filter);
  const target = editingId ?? (form ? NEW_AREA_ID : null);
  const editingArea = editingId && editingId !== NEW_AREA_ID ? details[editingId] : undefined;
  const warnings =
    editing && polygonIssues(editing.rings).length === 0
      ? overlapWarnings(editing.rings, withPolygon, editing.id === NEW_AREA_ID ? null : editing.id)
      : [];

  function resetEditor() {
    setDraft(null);
    setEditing(null);
    setForm(null);
    setErrors({});
    setPending(null);
    setMapMessage(null);
    setError(null);
  }

  function changeMode(next: Mode) {
    resetEditor();
    setNotice(null);
    setPoint(null);
    setPreview([]);
    setMode(next);
    if (next === 'draw') setDraft([]);
  }

  function closeDraft() {
    if (!draft) return;
    const result = closeDrawing(draft);
    if (!result.ok) {
      setMapMessage(result.message);
      return;
    }
    setDraft(null);
    setMode('idle');
    setEditing({ id: NEW_AREA_ID, rings: result.rings, selected: null });
    setForm(emptyAreaForm());
    setMapMessage(null);
  }

  function startEdit(area: Area) {
    changeMode('idle');
    setEditing({ id: area.id, rings: toEditable(area.polygon), selected: null });
    setForm(areaToForm(area));
    setFit({ points: area.polygon[0] ?? [], at: Date.now() });
  }

  function updateRings(
    update: (rings: EditableRings) => EditableRings,
    selected?: VertexRef | null,
  ) {
    setEditing((current) =>
      current
        ? {
            ...current,
            rings: update(current.rings),
            selected: selected === undefined ? current.selected : selected,
          }
        : current,
    );
    setPending(null);
    setMapMessage(null);
  }

  function removeVertex(ref: VertexRef) {
    if (!editing) return;
    const result = deleteVertex(editing.rings, ref);
    if (!result.ok) {
      setMapMessage(result.message);
      return;
    }
    setEditing({ ...editing, rings: result.rings, selected: null });
    setPending(null);
    setMapMessage(null);
  }

  function review() {
    if (!form || !editing) return;
    setError(null);
    const parsed = formToAreaFields(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    const issues = polygonIssues(editing.rings);
    if (issues.length > 0) {
      setError(`Revisa el polígono: ${issues.map((issue) => issue.message).join(' ')}`);
      return;
    }
    if (editing.id === NEW_AREA_ID) {
      const body = areaCreateBody(parsed.body, editing.rings);
      setPending({
        target: NEW_AREA_ID,
        title: `¿Crear ${AREA_KIND_LABELS[body.kind].toLowerCase()} ${body.name}?`,
        body,
        changes: areaChanges(null, body),
        warnings,
      });
      return;
    }
    const saved = details[editing.id];
    if (!saved) return;
    const body = areaUpdateBody(saved, parsed.body, editing.rings);
    if (Object.keys(body).length === 0) {
      resetEditor();
      setNotice('No hay cambios para guardar.');
      return;
    }
    setPending({
      target: editing.id,
      title: `¿Guardar los cambios en ${areaLabel(saved)}?`,
      body,
      changes: areaChanges(saved, body),
      warnings: body.polygon ? warnings : [],
    });
  }

  function reviewToggle(area: AreaSummary) {
    resetEditor();
    setNotice(null);
    const body: AreaUpdateBody = { active: !area.active };
    setPending({
      target: area.id,
      title: area.active ? `¿Desactivar ${areaLabel(area)}?` : `¿Activar ${areaLabel(area)}?`,
      body,
      changes: [
        {
          field: 'active',
          label: 'Activo',
          before: area.active ? 'Sí' : 'No',
          after: area.active ? 'No' : 'Sí',
        },
      ],
      warnings: area.active
        ? ['Desactivado no se usa para describir viajes ni aparece en la app.']
        : [],
    });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      const saved =
        pending.target === NEW_AREA_ID
          ? await createArea(pending.body as AreaCreateBody)
          : await updateArea(pending.target, pending.body as AreaUpdateBody);
      const name = saved ? areaLabel(saved) : 'El barrio o vereda';
      if (saved) setDetails((current) => ({ ...current, [saved.id]: saved }));
      else if (pending.target !== NEW_AREA_ID) {
        // Sin el barrio en la respuesta: se vuelve a pedir su polígono.
        const id = pending.target;
        setDetails(({ [id]: _old, ...rest }) => rest);
      }
      const message =
        pending.target === NEW_AREA_ID
          ? `${name} quedó creado.`
          : 'active' in pending.body && Object.keys(pending.body).length === 1
            ? `${name} quedó ${pending.body.active ? 'activo' : 'desactivado'}.`
            : `${name}: cambios guardados.`;
      resetEditor();
      setNotice(message);
      router.refresh();
    } catch (failure) {
      setPending(null);
      handleAdminFailure(
        failure,
        ADMIN_AREAS_PATH,
        () => catalogFailureMessage(toApiError(failure)),
        setError,
      );
    } finally {
      setBusy(false);
    }
  }

  const pointResult = point ? runPointTest(point, shownNow) : null;

  const editorPanel =
    editing && form ? (
      <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
        <PolygonPanel
          title={
            editing.id === NEW_AREA_ID
              ? 'Polígono nuevo: ajústalo y completa los datos'
              : `Editando el polígono de ${editingArea ? areaLabel(editingArea) : ''}`
          }
          saved={editingArea?.polygon ?? null}
          editing={editing}
          message={mapMessage}
          warnings={warnings}
          onSelect={(selected) => setEditing({ ...editing, selected })}
          onDelete={removeVertex}
          onInsertAfter={(ref) => {
            const result = insertMidpoint(editing.rings, ref.ring, ref.vertex);
            setEditing({ ...editing, rings: result.rings, selected: result.inserted });
            setPending(null);
          }}
          onReset={() => {
            if (!editingArea) return;
            setEditing({ ...editing, rings: toEditable(editingArea.polygon), selected: null });
            setPending(null);
            setMapMessage(null);
          }}
        />
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            review();
          }}
          className="flex flex-col gap-3"
        >
          <AreaFormFields
            idPrefix={`barrio-${editing.id}`}
            form={form}
            errors={errors}
            onChange={(next) => {
              setForm({ ...form, ...next });
              setErrors({});
              setPending(null);
            }}
          />
          {pending && pending.target === target ? (
            <ConfirmChanges
              id={`barrio-${editing.id}-confirmar`}
              title={pending.title}
              changes={pending.changes}
              warnings={pending.warnings}
              busy={busy}
              onConfirm={() => void confirm()}
              onCancel={() => setPending(null)}
            />
          ) : (
            <div className="flex gap-3">
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                {editing.id === NEW_AREA_ID ? 'Revisar y crear' : 'Guardar cambios'}
              </button>
              <button
                type="button"
                onClick={resetEditor}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
              >
                Cancelar
              </button>
            </div>
          )}
        </form>
      </div>
    ) : null;

  const busyEditing = editing !== null || draft !== null;

  return (
    <section aria-labelledby="barrios-mapa" className="flex flex-col gap-4">
      <h2 id="barrios-mapa" className="sr-only">
        Mapa de barrios y veredas
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul aria-label="Leyenda del mapa" className="flex flex-wrap gap-4 text-sm text-stone-700">
          {AREA_KINDS.map((kind) => (
            <li key={kind} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-5 rounded-sm border-2"
                style={{
                  borderColor: AREA_KIND_COLOR[kind],
                  backgroundColor: `${AREA_KIND_COLOR[kind]}33`,
                }}
              />
              {AREA_KIND_LABELS[kind]}
            </li>
          ))}
          <li className="text-stone-500">Los desactivados se ven más tenues.</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={mode === 'draw'}
            onClick={() => changeMode(mode === 'draw' ? 'idle' : 'draw')}
            className={toolClass(mode === 'draw')}
          >
            {mode === 'draw' ? 'Cancelar dibujo' : 'Dibujar barrio o vereda'}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'test'}
            onClick={() => changeMode(mode === 'test' ? 'idle' : 'test')}
            className={toolClass(mode === 'test')}
          >
            {mode === 'test' ? 'Terminar prueba' : 'Probar un punto'}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'import'}
            onClick={() => changeMode(mode === 'import' ? 'idle' : 'import')}
            className={toolClass(mode === 'import')}
          >
            Importar GeoJSON
          </button>
        </div>
      </div>
      <p className="text-sm text-stone-600">{AREAS_MAP_HELP}</p>

      <PanterMap ariaLabel="Mapa de barrios y veredas de Villagarzón" className="h-[30rem]">
        <PolygonLayers
          id="panter-areas"
          labels
          shapes={shapes}
          editing={editing}
          drawing={draft}
          onDrawVertex={(p) => {
            setDraft((current) => (current ? addDrawVertex(current, p) : current));
            setMapMessage(null);
          }}
          onDrawClose={closeDraft}
          testMode={mode === 'test'}
          testPoint={point}
          onTestPoint={setPoint}
          onShapeClick={(id) => {
            const area = areas.find((a) => a.id === id);
            if (area) setFilter({ q: area.name, kind: area.kind });
          }}
          onVertexSelect={(ref) => editing && setEditing({ ...editing, selected: ref })}
          onVertexMove={(ref, to) => updateRings((rings) => moveVertex(rings, ref, to), ref)}
          onVertexDelete={removeVertex}
          onMidpointClick={(ring, side) => {
            if (!editing) return;
            const result = insertMidpoint(editing.rings, ring, side);
            setEditing({ ...editing, rings: result.rings, selected: result.inserted });
            setPending(null);
            setMapMessage(null);
          }}
        />
        <PolygonLayers
          id="panter-areas-import"
          labels
          shapes={preview}
          editing={null}
          testMode={false}
          testPoint={null}
          onTestPoint={() => undefined}
          onVertexSelect={() => undefined}
          onVertexMove={() => undefined}
          onVertexDelete={() => undefined}
          onMidpointClick={() => undefined}
        />
        <FitBounds target={fit} />
      </PanterMap>

      {detailsError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <span>{detailsError}</span>
          <button type="button" onClick={() => setReload((n) => n + 1)} className="underline">
            Reintentar
          </button>
        </div>
      ) : missingIds.length > 0 ? (
        <p role="status" className="text-sm text-stone-500">
          {`Cargando polígonos (${areas.length - missingIds.length} de ${areas.length})…`}
        </p>
      ) : null}

      {draft ? (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-stone-700">
          <p className="font-medium text-stone-900">Dibujando un barrio o vereda nuevo</p>
          <p>{DRAW_HELP}</p>
          <p>
            {draft.length === 1 ? '1 vértice' : `${draft.length} vértices`}
            {draft.length > 0 ? ` · último: ${formatLatLng(draft[draft.length - 1]!)}` : ''}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!canCloseDrawing(draft)}
              onClick={closeDraft}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              Cerrar polígono
            </button>
            <button
              type="button"
              disabled={draft.length === 0}
              onClick={() => setDraft(undoDrawVertex(draft))}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 font-medium hover:bg-stone-100 disabled:opacity-60"
            >
              Deshacer último punto
            </button>
          </div>
          {mapMessage ? (
            <p aria-live="polite" className="text-red-700">
              {mapMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      {mode === 'test' ? (
        <div
          aria-live="polite"
          className="flex flex-col gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-stone-700"
        >
          {point && pointResult ? (
            <>
              <p className="font-medium text-stone-900">Punto {formatLatLng(point)}</p>
              <p>{pointTestMessage(pointResult)}</p>
            </>
          ) : (
            <p>{TEST_POINT_HELP}</p>
          )}
        </div>
      ) : null}

      {mode === 'import' ? (
        <AreaImport
          onPreview={(next) => {
            setPreview(next);
            const points = next.flatMap((s) => s.polygon[0] ?? []);
            if (points.length > 0) setFit({ points, at: Date.now() });
          }}
          onImported={(saved) => {
            setMode('idle');
            setPreview([]);
            setDetails({});
            setNotice(
              saved === 1
                ? 'Se importó 1 barrio o vereda.'
                : `Se importaron ${saved} barrios y veredas.`,
            );
            router.refresh();
          }}
          onClose={() => setMode('idle')}
        />
      ) : null}

      {editing?.id === NEW_AREA_ID ? editorPanel : null}

      <div aria-live="polite">
        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : notice ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-stone-900">Lista</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div className="flex flex-col gap-1">
            <label htmlFor="barrios-buscar" className="text-sm font-medium text-stone-700">
              Buscar por nombre
            </label>
            <input
              id="barrios-buscar"
              type="search"
              value={filter.q}
              placeholder="p. ej. san jose"
              onChange={(event) => setFilter({ ...filter, q: event.target.value })}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="barrios-tipo" className="text-sm font-medium text-stone-700">
              Tipo
            </label>
            <select
              id="barrios-tipo"
              value={filter.kind}
              onChange={(event) =>
                setFilter({ ...filter, kind: event.target.value as AreaKind | '' })
              }
              className={inputClass}
            >
              <option value="">Barrios y veredas</option>
              {AREA_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind === 'BARRIO' ? 'Solo barrios' : 'Solo veredas'}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-sm text-stone-500" aria-live="polite">
          {listed.length === areas.length
            ? `${areas.length} en total.`
            : `${listed.length} de ${areas.length}.`}
        </p>
        {areas.length === 0 ? (
          <p className="text-stone-600">
            Todavía no hay barrios ni veredas. Dibuja el primero o importa un GeoJSON.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {listed.map((area) => {
              const detail = details[area.id];
              const isEditing = editingId === area.id;
              return (
                <li
                  key={area.id}
                  className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-stone-900">
                        <span
                          aria-hidden="true"
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: AREA_KIND_COLOR[area.kind] }}
                        />
                        {area.name}
                        <span className="text-sm font-normal text-stone-600">
                          {AREA_KIND_LABELS[area.kind]}
                        </span>
                        {area.active ? null : (
                          <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-semibold text-stone-700">
                            Desactivado
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-stone-600">
                        {detail
                          ? `Polígono: ${describePolygon(isEditing && editing ? editing.rings : detail.polygon)}${detail.source ? ` · Fuente: ${detail.source}` : ''}`
                          : 'Cargando el polígono…'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!detail}
                        onClick={() =>
                          detail && setFit({ points: detail.polygon[0] ?? [], at: Date.now() })
                        }
                        className={rowButton}
                      >
                        Ver en el mapa
                      </button>
                      <button
                        type="button"
                        disabled={!detail || (busyEditing && !isEditing)}
                        onClick={() => detail && startEdit(detail)}
                        className={rowButton}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        disabled={busyEditing}
                        onClick={() => reviewToggle(area)}
                        className={rowButton}
                      >
                        {area.active ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </div>
                  {isEditing ? editorPanel : null}
                  {pending && pending.target === area.id && !isEditing ? (
                    <ConfirmChanges
                      id={`barrio-${area.id}-estado`}
                      title={pending.title}
                      changes={pending.changes}
                      warnings={pending.warnings}
                      busy={busy}
                      onConfirm={() => void confirm()}
                      onCancel={() => setPending(null)}
                    />
                  ) : null}
                  <CatalogHistory
                    load={(cursor) => fetchAreaHistory(area.id, cursor)}
                    returnTo={ADMIN_AREAS_PATH}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

const rowButton =
  'rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60';

function toolClass(active: boolean): string {
  return `rounded-lg border px-3 py-1.5 text-sm font-medium ${
    active
      ? 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800'
      : 'border-stone-300 text-stone-700 hover:bg-stone-100'
  }`;
}
