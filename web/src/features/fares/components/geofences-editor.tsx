'use client';

import {
  isInServiceArea,
  type Geofence,
  type LatLng,
  type PolygonRings,
  type VehicleType,
} from '@panter/contracts';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { handleAdminFailure } from '@/features/admin/lib/admin-failure';
import { PanterMap } from '@/features/map/components/panter-map';
import { toApiError } from '@/shared/api/errors';
import { formatCop, VEHICLE_LABEL } from '@/shared/lib/format';
import { saveGeofence } from '../api/fares-client';
import {
  ADMIN_FARES_PATH,
  formatLatLng,
  formToGeofenceBody,
  GEOFENCE_KIND_LABEL,
  geofenceBody,
  geofenceSaveBody,
  geofenceToForm,
  polygonSummary,
  VEHICLE_ORDER,
  type FieldErrors,
  type GeofenceForm,
  type GeofenceFormField,
  type GeofenceUpdateBody,
} from '../lib/fares';
import { GEOFENCE_KIND_COLOR, geofencesAt, shownGeofence } from '../lib/geofence-map';
import { diffSnapshots, type FieldChange } from '../lib/history';
import { fareErrorMessage, polygonRejectionMessage } from '../lib/messages';
import {
  PolygonLayers,
  type PolygonEditing,
} from '@/features/geo-editor/components/polygon-layers';
import { PolygonPanel } from '@/features/geo-editor/components/polygon-panel';
import {
  deleteVertex,
  describePolygonChange,
  insertMidpoint,
  moveVertex,
  samePolygon,
  toEditable,
  type EditableRings,
  type VertexRef,
} from '@/features/geo-editor/lib/polygon-edit';
import { polygonIssues } from '@/features/geo-editor/lib/polygon-validation';
import { DiffList, inputClass, MoneyField } from './form-fields';

export const MAP_HELP =
  'Haz clic en «Editar» en una geocerca para cambiar su polígono sobre el mapa. Con «Probar un punto» compruebas qué recargos cobra un lugar.';
export const TEST_POINT_HELP =
  'Haz clic en el mapa para ver qué geocercas cubren ese punto y qué recargo se cobraría.';

/** Geocercas con recargo (HU-403) con su polígono editable sobre el mapa (HU-304). */
export function GeofencesEditor({ geofences }: { geofences: readonly Geofence[] }) {
  const [savedPolygons, setSavedPolygons] = useState<Record<string, PolygonRings>>(() =>
    Object.fromEntries(geofences.map((g) => [g.id, g.polygon])),
  );
  const [editing, setEditing] = useState<PolygonEditing | null>(null);
  const [mapMessage, setMapMessage] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [testPoint, setTestPoint] = useState<LatLng | null>(null);

  const polygonOf = (g: Geofence) => savedPolygons[g.id] ?? g.polygon;
  const shown = geofences.map((g) => shownGeofence(g, polygonOf(g)));
  const shownNow = shown.map((g) =>
    editing?.id === g.id ? { ...g, polygon: editing.rings as PolygonRings } : g,
  );
  const editingGeofence = editing ? geofences.find((g) => g.id === editing.id) : undefined;

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
    setMapMessage(null);
  }

  return (
    <section aria-labelledby="geocercas" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="geocercas" className="text-xl font-semibold text-stone-900">
          Geocercas
        </h2>
        <p className="text-sm text-stone-600">
          El recargo se cobra una vez por viaje si el origen o el destino caen dentro de la zona.{' '}
          {MAP_HELP}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ul aria-label="Leyenda del mapa" className="flex flex-wrap gap-4 text-sm text-stone-700">
            {Object.entries(GEOFENCE_KIND_LABEL).map(([kind, label]) => (
              <li key={kind} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-5 rounded-sm border-2"
                  style={{
                    borderColor: GEOFENCE_KIND_COLOR[kind as keyof typeof GEOFENCE_KIND_COLOR],
                    backgroundColor: `${GEOFENCE_KIND_COLOR[kind as keyof typeof GEOFENCE_KIND_COLOR]}33`,
                  }}
                />
                {label}
              </li>
            ))}
            <li className="text-stone-500">
              Los huecos (p. ej. el casco urbano) no cobran recargo.
            </li>
          </ul>
          <button
            type="button"
            aria-pressed={testMode}
            onClick={() => {
              setTestMode(!testMode);
              setTestPoint(null);
            }}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
              testMode
                ? 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800'
                : 'border-stone-300 text-stone-700 hover:bg-stone-100'
            }`}
          >
            {testMode ? 'Terminar prueba' : 'Probar un punto'}
          </button>
        </div>

        <PanterMap ariaLabel="Mapa de geocercas de Villagarzón" className="h-[28rem]">
          <PolygonLayers
            id="panter-geofences"
            shapes={shown}
            editing={editing}
            testMode={testMode}
            testPoint={testPoint}
            onTestPoint={setTestPoint}
            onVertexSelect={(ref) => editing && setEditing({ ...editing, selected: ref })}
            onVertexMove={(ref, to) => updateRings((rings) => moveVertex(rings, ref, to), ref)}
            onVertexDelete={removeVertex}
            onMidpointClick={(ring, side) => {
              if (!editing) return;
              const result = insertMidpoint(editing.rings, ring, side);
              setEditing({ ...editing, rings: result.rings, selected: result.inserted });
              setMapMessage(null);
            }}
          />
        </PanterMap>

        {testMode ? (
          <TestPointResult point={testPoint} geofences={geofences} shown={shownNow} />
        ) : null}

        {editing && editingGeofence ? (
          <PolygonPanel
            title={`Editando el polígono de ${editingGeofence.name}`}
            saved={polygonOf(editingGeofence)}
            editing={editing}
            message={mapMessage}
            onSelect={(selected) => setEditing({ ...editing, selected })}
            onDelete={removeVertex}
            onInsertAfter={(ref) => {
              const result = insertMidpoint(editing.rings, ref.ring, ref.vertex);
              setEditing({ ...editing, rings: result.rings, selected: result.inserted });
            }}
            onReset={() => {
              setEditing({
                ...editing,
                rings: toEditable(polygonOf(editingGeofence)),
                selected: null,
              });
              setMapMessage(null);
            }}
          />
        ) : null}
      </div>

      {geofences.length === 0 ? (
        <p className="text-stone-600">No hay geocercas configuradas.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {geofences.map((geofence) => (
            <GeofenceRow
              key={geofence.id}
              geofence={geofence}
              savedPolygon={polygonOf(geofence)}
              editedRings={editing?.id === geofence.id ? editing.rings : null}
              locked={editing !== null && editing.id !== geofence.id}
              onStartEdit={() => {
                setEditing({
                  id: geofence.id,
                  rings: toEditable(polygonOf(geofence)),
                  selected: null,
                });
                setMapMessage(null);
                setTestMode(false);
              }}
              onStopEdit={() => setEditing(null)}
              onSaved={(polygon) => {
                setSavedPolygons((current) => ({ ...current, [geofence.id]: polygon }));
                setEditing(null);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Resultado de "Probar un punto": geocercas que cubren el punto y su recargo. */
export function TestPointResult({
  point,
  geofences,
  shown,
}: {
  point: LatLng | null;
  geofences: readonly Geofence[];
  shown: ReturnType<typeof shownGeofence>[];
}) {
  let content: ReactNode;
  if (!point) {
    content = <p>{TEST_POINT_HELP}</p>;
  } else {
    const hits = geofencesAt(point, shown).map((hit) => geofences.find((g) => g.id === hit.id)!);
    content = (
      <>
        <p className="font-medium text-stone-900">Punto {formatLatLng(point)}</p>
        {!isInServiceArea(point) ? (
          <p>Este punto está fuera del área de servicio de PANTER.</p>
        ) : hits.length === 0 ? (
          <p>Ninguna geocerca cubre este punto: no se cobra recargo por zona.</p>
        ) : (
          <ul className="list-disc pl-5">
            {hits.map((g) => (
              <li key={g.id}>
                {g.name} ({GEOFENCE_KIND_LABEL[g.kind]}): recargo de {formatCop(g.surcharge)} para{' '}
                {VEHICLE_ORDER.filter((t) => g.appliesTo.includes(t))
                  .map((t) => VEHICLE_LABEL[t])
                  .join(', ')}
                {g.active ? '' : ' — inactiva, hoy no se cobra'}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  return (
    <div
      aria-live="polite"
      className="flex flex-col gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-stone-700"
    >
      {content}
    </div>
  );
}

function GeofenceRow({
  geofence,
  savedPolygon,
  editedRings,
  locked,
  onStartEdit,
  onStopEdit,
  onSaved,
}: {
  geofence: Geofence;
  savedPolygon: PolygonRings;
  editedRings: EditableRings | null;
  locked: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onSaved: (polygon: PolygonRings) => void;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<GeofenceUpdateBody>(() => geofenceBody(geofence));
  const [form, setForm] = useState<GeofenceForm | null>(null);
  const [errors, setErrors] = useState<FieldErrors<GeofenceFormField>>({});
  const [pending, setPending] = useState<{
    body: GeofenceUpdateBody;
    changes: FieldChange[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const id = (field: string) => `geocerca-${geofence.id}-${field}`;
  const polygonChanged = editedRings !== null && !samePolygon(savedPolygon, editedRings);

  function edit() {
    setForm(geofenceToForm({ ...geofence, ...saved }));
    setErrors({});
    setPending(null);
    setNotice(null);
    setError(null);
    onStartEdit();
  }

  function cancel() {
    setForm(null);
    setPending(null);
    setError(null);
    onStopEdit();
  }

  function update(next: Partial<GeofenceForm>) {
    if (!form) return;
    setForm({ ...form, ...next });
    setPending(null);
    setErrors({});
  }

  function review() {
    if (!form) return;
    setError(null);
    const parsed = formToGeofenceBody(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    if (polygonChanged) {
      const issues = polygonIssues(editedRings);
      if (issues.length > 0) {
        setError(`Revisa el polígono: ${issues.map((issue) => issue.message).join(' ')}`);
        return;
      }
    }
    const body = geofenceSaveBody(parsed.body, savedPolygon, editedRings);
    const { polygon, ...fields } = body;
    const changes = diffSnapshots(saved, fields);
    if (polygon) {
      changes.push({
        field: 'polygon',
        label: 'Polígono',
        ...describePolygonChange(savedPolygon, polygon),
      });
    }
    if (changes.length === 0) {
      cancel();
      setNotice('No hay cambios para guardar.');
      return;
    }
    setPending({ body, changes });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      await saveGeofence(geofence.id, pending.body);
      const { polygon, ...fields } = pending.body;
      setSaved(fields);
      setForm(null);
      setPending(null);
      setNotice('Geocerca guardada.');
      onSaved(polygon ?? savedPolygon);
      router.refresh();
    } catch (failure) {
      setPending(null);
      const rejected = polygonRejectionMessage(toApiError(failure));
      if (rejected) setError(rejected);
      else handleAdminFailure(failure, ADMIN_FARES_PATH, fareErrorMessage, setError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <dl className="grid flex-1 gap-3 text-sm sm:grid-cols-5">
          <div>
            <dt className="text-xs font-semibold text-stone-500 uppercase">Nombre</dt>
            <dd className="font-medium text-stone-900">{saved.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-500 uppercase">Tipo</dt>
            <dd className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: GEOFENCE_KIND_COLOR[geofence.kind] }}
              />
              {GEOFENCE_KIND_LABEL[geofence.kind]}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-500 uppercase">Recargo</dt>
            <dd className="tabular-nums">{formatCop(saved.surcharge)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-500 uppercase">Aplica a</dt>
            <dd>
              {VEHICLE_ORDER.filter((type) => saved.appliesTo.includes(type))
                .map((type) => VEHICLE_LABEL[type])
                .join(', ')}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-500 uppercase">Activa</dt>
            <dd>{saved.active ? 'Sí' : 'No'}</dd>
          </div>
        </dl>
        {form ? null : (
          <button
            type="button"
            onClick={edit}
            disabled={locked}
            title={locked ? 'Termina primero la geocerca que estás editando.' : undefined}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
          >
            Editar
          </button>
        )}
      </div>

      <p className="text-sm text-stone-600">
        Polígono: {polygonSummary({ polygon: editedRings ?? savedPolygon })}
        {polygonChanged ? ' (con cambios sin guardar)' : ''}
      </p>

      {form ? (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            review();
          }}
          className="flex flex-col gap-3 border-t border-stone-200 pt-3"
        >
          <p className="text-sm text-stone-600">Edita el polígono sobre el mapa de arriba.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={id('name')} className="text-sm font-medium text-stone-700">
                Nombre
              </label>
              <input
                id={id('name')}
                value={form.name}
                maxLength={80}
                onChange={(event) => update({ name: event.target.value })}
                aria-invalid={errors.name ? true : undefined}
                className={inputClass}
              />
              {errors.name ? <p className="text-sm text-red-700">{errors.name}</p> : null}
            </div>
            <MoneyField
              id={id('surcharge')}
              label="Recargo"
              value={form.surcharge}
              error={errors.surcharge}
              onChange={(value) => update({ surcharge: value })}
            />
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium text-stone-700">Aplica a</legend>
            <div className="flex flex-wrap gap-4">
              {VEHICLE_ORDER.map((type: VehicleType) => (
                <label key={type} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.appliesTo.includes(type)}
                    onChange={(event) =>
                      update({
                        appliesTo: event.target.checked
                          ? [...form.appliesTo, type]
                          : form.appliesTo.filter((t) => t !== type),
                      })
                    }
                    className="h-4 w-4 accent-emerald-700"
                  />
                  {VEHICLE_LABEL[type]}
                </label>
              ))}
            </div>
            {errors.appliesTo ? <p className="text-sm text-red-700">{errors.appliesTo}</p> : null}
          </fieldset>
          <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => update({ active: event.target.checked })}
              className="h-4 w-4 accent-emerald-700"
            />
            Activa
          </label>

          {pending ? (
            <div
              role="alertdialog"
              aria-labelledby={id('confirmar')}
              className="rounded-lg border border-amber-300 bg-amber-50 p-3"
            >
              <p id={id('confirmar')} className="mb-2 font-medium text-stone-900">
                ¿Guardar estos cambios en la geocerca?
              </p>
              <DiffList changes={pending.changes} />
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={confirm}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  {busy ? 'Guardando…' : 'Confirmar'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPending(null)}
                  className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Guardar cambios
              </button>
              <button
                type="button"
                onClick={cancel}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
              >
                Cancelar
              </button>
            </div>
          )}
        </form>
      ) : null}

      <div aria-live="polite">
        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : notice ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
        ) : null}
      </div>
    </li>
  );
}
