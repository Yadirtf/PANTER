'use client';

import type { Geofence, VehicleType } from '@panter/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { handleAdminFailure } from '@/features/admin/lib/admin-failure';
import { formatCop, VEHICLE_LABEL } from '@/shared/lib/format';
import { saveGeofence } from '../api/fares-client';
import {
  ADMIN_FARES_PATH,
  formatLatLng,
  formToGeofenceBody,
  GEOFENCE_KIND_LABEL,
  geofenceBody,
  geofenceToForm,
  polygonSummary,
  VEHICLE_ORDER,
  type FieldErrors,
  type GeofenceForm,
  type GeofenceFormField,
  type GeofenceUpdateBody,
} from '../lib/fares';
import { diffSnapshots, type FieldChange } from '../lib/history';
import { fareErrorMessage } from '../lib/messages';
import { DiffList, inputClass, MoneyField } from './form-fields';

export const POLYGON_READ_ONLY_NOTE =
  'El polígono no se edita en esta pantalla: el editor sobre el mapa llega con HU-304 (mapa en la web). Por ahora sus vértices se muestran en solo lectura.';

/** Geocercas con recargo: nombre, recargo, a qué vehículos aplica y si está activa (HU-403). */
export function GeofencesEditor({ geofences }: { geofences: readonly Geofence[] }) {
  return (
    <section aria-labelledby="geocercas" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="geocercas" className="text-xl font-semibold text-stone-900">
          Geocercas
        </h2>
        <p className="text-sm text-stone-600">
          El recargo se cobra una vez por viaje si el origen o el destino caen dentro de la zona.{' '}
          {POLYGON_READ_ONLY_NOTE}
        </p>
      </div>
      {geofences.length === 0 ? (
        <p className="text-stone-600">No hay geocercas configuradas.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {geofences.map((geofence) => (
            <GeofenceRow key={geofence.id} geofence={geofence} />
          ))}
        </ul>
      )}
    </section>
  );
}

function GeofenceRow({ geofence }: { geofence: Geofence }) {
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

  function edit() {
    setForm(geofenceToForm({ ...geofence, ...saved }));
    setErrors({});
    setPending(null);
    setNotice(null);
    setError(null);
  }

  function update(next: Partial<GeofenceForm>) {
    if (!form) return;
    setForm({ ...form, ...next });
    setPending(null);
    setErrors({});
  }

  function review() {
    if (!form) return;
    const parsed = formToGeofenceBody(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    const changes = diffSnapshots(saved, parsed.body);
    if (changes.length === 0) {
      setForm(null);
      setNotice('No hay cambios para guardar.');
      return;
    }
    setPending({ body: parsed.body, changes });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      await saveGeofence(geofence.id, pending.body);
      setSaved(pending.body);
      setForm(null);
      setPending(null);
      setNotice('Geocerca guardada.');
      router.refresh();
    } catch (failure) {
      setPending(null);
      handleAdminFailure(failure, ADMIN_FARES_PATH, fareErrorMessage, setError);
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
            <dd>{GEOFENCE_KIND_LABEL[geofence.kind]}</dd>
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
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
          >
            Editar
          </button>
        )}
      </div>

      <details className="text-sm text-stone-600">
        <summary className="cursor-pointer">
          Polígono: {polygonSummary(geofence)} (solo lectura)
        </summary>
        <ol className="mt-2 flex flex-col gap-2">
          {geofence.polygon.map((ring, index) => (
            <li key={index}>
              <p className="font-medium">{index === 0 ? 'Borde exterior' : `Hueco ${index}`}</p>
              <ol className="ml-4 list-decimal font-mono text-xs">
                {ring.map((point, i) => (
                  <li key={i}>{formatLatLng(point)}</li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </details>

      {form ? (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            review();
          }}
          className="flex flex-col gap-3 border-t border-stone-200 pt-3"
        >
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
                onClick={() => setForm(null)}
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
