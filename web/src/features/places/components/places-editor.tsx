'use client';

import {
  PLACE_CATEGORY_LABELS,
  PLACES,
  type LatLng,
  type Place,
  type PlaceCategory,
  type PlaceCreateBody,
  type PlaceUpdateBody,
} from '@panter/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { handleAdminFailure } from '@/features/admin/lib/admin-failure';
import { ConfirmChanges } from '@/features/areas/components/area-form';
import { createPlace, fetchPlaceHistory, updatePlace } from '@/features/catalog/api/catalog-client';
import { CatalogHistory } from '@/features/catalog/components/catalog-history';
import { placeFailureMessage } from '@/features/catalog/lib/messages';
import { inputClass } from '@/features/fares/components/form-fields';
import type { FieldErrors } from '@/features/fares/lib/fares';
import type { FieldChange } from '@/features/fares/lib/history';
import { FitBounds, type FitTarget } from '@/features/geo-editor/components/fit-bounds';
import { formatLatLng } from '@/features/geo-editor/lib/polygon-map';
import { CatalogPlacesLayer } from '@/features/map/components/catalog-places-layer';
import { PanterMap } from '@/features/map/components/panter-map';
import { PLACE_CATEGORY_COLOR, UNVERIFIED_COLOR } from '@/features/map/lib/catalog-places';
import { toApiError } from '@/shared/api/errors';
import {
  ADMIN_PLACES_PATH,
  emptyPlaceForm,
  filterPlaces,
  formToPlaceBody,
  NEW_PLACE_ID,
  PLACE_CATEGORIES,
  PLACE_VALUE_LABELS,
  pickupWarning,
  placeAreaText,
  placeChanges,
  placeToForm,
  placeUpdateBody,
  withName,
  type PlaceFilter,
  type PlaceForm,
  type PlaceFormField,
} from '../lib/places';
import { PLACE_POINT_COLOR, PlaceEditLayer, type PlacePoint } from './place-edit-layer';

export const PLACES_MAP_HELP =
  'Los lugares sin verificar en sitio llevan un anillo ámbar. Con «Nuevo lugar» o «Editar», haz clic en el mapa para ubicarlo o arrastra su marcador; el barrio o vereda lo calcula PANTER al guardar.';
export const UNVERIFIED_BADGE = 'Sin verificar';

interface Pending {
  target: string;
  title: string;
  body: PlaceCreateBody | PlaceUpdateBody;
  changes: FieldChange[];
  warnings: string[];
}

/** Lugares de interés (HU-310): lista por categoría con búsqueda, mapa y edición. */
export function PlacesEditor({ places }: { places: readonly Place[] }) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, Place>>({});
  const [filter, setFilter] = useState<PlaceFilter>({ q: '', category: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PlaceForm | null>(null);
  const [target, setTarget] = useState<PlacePoint>('location');
  const [errors, setErrors] = useState<FieldErrors<PlaceFormField>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fit, setFit] = useState<FitTarget | null>(null);

  const known = new Set(places.map((p) => p.id));
  const current = [
    ...places.map((p) => overrides[p.id] ?? p),
    ...Object.values(overrides).filter((p) => !known.has(p.id)),
  ];
  const listed = filterPlaces(current, filter);
  const shownOnMap = current.filter((p) => p.id !== editingId);
  const editingPlace =
    editingId && editingId !== NEW_PLACE_ID ? current.find((p) => p.id === editingId) : undefined;
  const warning = form ? pickupWarning(form.location, form.pickupPoint) : null;

  function close() {
    setEditingId(null);
    setForm(null);
    setErrors({});
    setPending(null);
    setError(null);
    setTarget('location');
  }

  function startNew() {
    close();
    setNotice(null);
    setEditingId(NEW_PLACE_ID);
    setForm(emptyPlaceForm());
  }

  function startEdit(place: Place) {
    close();
    setNotice(null);
    setEditingId(place.id);
    setForm(placeToForm(place));
    setFit({
      points: [place.location, ...(place.pickupPoint ? [place.pickupPoint] : [])],
      at: Date.now(),
    });
  }

  function update(next: Partial<PlaceForm>) {
    setForm((f) => (f ? { ...f, ...next } : f));
    setErrors({});
    setPending(null);
  }

  function setPoint(which: PlacePoint, point: LatLng) {
    update(which === 'location' ? { location: point } : { pickupPoint: point });
  }

  function review() {
    if (!form || !editingId) return;
    setError(null);
    const parsed = formToPlaceBody(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    const warnings = warning ? [warning] : [];
    if (editingId === NEW_PLACE_ID) {
      setPending({
        target: NEW_PLACE_ID,
        title: `¿Crear el lugar ${parsed.body.name}?`,
        body: parsed.body,
        changes: placeChanges(null, parsed.body),
        warnings,
      });
      return;
    }
    if (!editingPlace) return;
    const body = placeUpdateBody(editingPlace, parsed.body);
    if (Object.keys(body).length === 0) {
      close();
      setNotice('No hay cambios para guardar.');
      return;
    }
    setPending({
      target: editingPlace.id,
      title: `¿Guardar los cambios en ${editingPlace.name}?`,
      body,
      changes: placeChanges(editingPlace, body),
      warnings,
    });
  }

  function reviewToggle(place: Place) {
    close();
    setNotice(null);
    const body: PlaceUpdateBody = { active: !place.active };
    setPending({
      target: place.id,
      title: place.active ? `¿Desactivar ${place.name}?` : `¿Activar ${place.name}?`,
      body,
      changes: placeChanges(place, body),
      warnings: place.active
        ? ['Desactivado deja de aparecer en los mapas y en la app de pasajeros.']
        : [],
    });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      const saved =
        pending.target === NEW_PLACE_ID
          ? await createPlace(pending.body as PlaceCreateBody)
          : await updatePlace(pending.target, pending.body as PlaceUpdateBody);
      if (saved) setOverrides((o) => ({ ...o, [saved.id]: saved }));
      const nextActive = (pending.body as PlaceUpdateBody).active;
      const toggled = nextActive !== undefined && Object.keys(pending.body).length === 1;
      const what = saved?.name ?? 'El lugar';
      const base =
        pending.target === NEW_PLACE_ID
          ? `${what} quedó creado.`
          : toggled
            ? `${what} quedó ${nextActive ? 'activo' : 'desactivado'}.`
            : `${what}: cambios guardados.`;
      close();
      setNotice(
        saved && !toggled ? `${base} Barrio o vereda calculado: ${placeAreaText(saved)}.` : base,
      );
      router.refresh();
    } catch (failure) {
      setPending(null);
      handleAdminFailure(
        failure,
        ADMIN_PLACES_PATH,
        () => placeFailureMessage(toApiError(failure)),
        setError,
      );
    } finally {
      setBusy(false);
    }
  }

  const editorPanel =
    form && editingId ? (
      <PlaceFormPanel
        id={editingId}
        form={form}
        place={editingPlace ?? null}
        errors={errors}
        target={target}
        warning={warning}
        pending={pending && pending.target === editingId ? pending : null}
        busy={busy}
        onChange={update}
        onTarget={setTarget}
        onReview={review}
        onConfirm={() => void confirm()}
        onCancelConfirm={() => setPending(null)}
        onClose={close}
      />
    ) : null;

  return (
    <section aria-labelledby="lugares-mapa" className="flex flex-col gap-4">
      <h2 id="lugares-mapa" className="sr-only">
        Mapa de lugares
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-600">{PLACES_MAP_HELP}</p>
        <button
          type="button"
          onClick={startNew}
          disabled={editingId !== null}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          Nuevo lugar
        </button>
      </div>

      <PanterMap ariaLabel="Mapa de lugares de Villagarzón" className="h-[30rem]">
        <CatalogPlacesLayer
          places={shownOnMap}
          onPlaceClick={(id) => {
            if (editingId) return;
            const place = current.find((p) => p.id === id);
            if (place) setFilter({ q: place.name, category: place.category });
          }}
        />
        <PlaceEditLayer
          enabled={form !== null}
          location={form?.location ?? null}
          pickup={form?.pickupPoint ?? null}
          target={target}
          onSet={setPoint}
        />
        <FitBounds target={fit} />
      </PanterMap>

      <ul aria-label="Leyenda del mapa" className="flex flex-wrap gap-4 text-sm text-stone-700">
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-full border-2"
            style={{ borderColor: UNVERIFIED_COLOR }}
          />
          Sin verificar en sitio
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: PLACE_POINT_COLOR.location }}
          />
          Lugar en edición
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: PLACE_POINT_COLOR.pickup }}
          />
          Punto de recogida
        </li>
      </ul>

      {editingId === NEW_PLACE_ID ? editorPanel : null}

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
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
          <div className="flex flex-col gap-1">
            <label htmlFor="lugares-buscar" className="text-sm font-medium text-stone-700">
              Buscar por nombre
            </label>
            <input
              id="lugares-buscar"
              type="search"
              value={filter.q}
              placeholder="p. ej. cascadas"
              onChange={(event) => setFilter({ ...filter, q: event.target.value })}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="lugares-categoria" className="text-sm font-medium text-stone-700">
              Categoría
            </label>
            <select
              id="lugares-categoria"
              value={filter.category}
              onChange={(event) =>
                setFilter({ ...filter, category: event.target.value as PlaceCategory | '' })
              }
              className={inputClass}
            >
              <option value="">Todas</option>
              {PLACE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {PLACE_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-sm text-stone-500" aria-live="polite">
          {listed.length === current.length
            ? `${current.length} en total.`
            : `${listed.length} de ${current.length}.`}
        </p>
        {current.length === 0 ? (
          <p className="text-stone-600">
            Todavía no hay lugares. Crea el primero con «Nuevo lugar».
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {listed.map((place) => {
              const isEditing = editingId === place.id;
              return (
                <li
                  key={place.id}
                  className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-stone-900">
                        <span
                          aria-hidden="true"
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: PLACE_CATEGORY_COLOR[place.category] }}
                        />
                        {place.name}
                        <span className="text-sm font-normal text-stone-600">
                          {PLACE_CATEGORY_LABELS[place.category]}
                        </span>
                        {place.verified ? null : (
                          <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-950">
                            {UNVERIFIED_BADGE}
                          </span>
                        )}
                        {place.active ? null : (
                          <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-semibold text-stone-700">
                            Desactivado
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-stone-600">
                        {`${placeAreaText(place)} · ${formatLatLng(place.location)}`}
                        {place.pickupPoint ? ' · con punto de recogida' : ''}
                      </p>
                      {place.source ? (
                        <p className="text-xs text-stone-500">Fuente: {place.source}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setFit({ points: [place.location], at: Date.now() })}
                        className={rowButton}
                      >
                        Ver en el mapa
                      </button>
                      <button
                        type="button"
                        disabled={editingId !== null && !isEditing}
                        onClick={() => startEdit(place)}
                        className={rowButton}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        disabled={editingId !== null}
                        onClick={() => reviewToggle(place)}
                        className={rowButton}
                      >
                        {place.active ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </div>
                  {isEditing ? editorPanel : null}
                  {pending && pending.target === place.id && !isEditing ? (
                    <ConfirmChanges
                      id={`lugar-${place.id}-estado`}
                      title={pending.title}
                      changes={pending.changes}
                      warnings={pending.warnings}
                      busy={busy}
                      onConfirm={() => void confirm()}
                      onCancel={() => setPending(null)}
                    />
                  ) : null}
                  <CatalogHistory
                    load={(cursor) => fetchPlaceHistory(place.id, cursor)}
                    returnTo={ADMIN_PLACES_PATH}
                    labels={PLACE_VALUE_LABELS}
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

function PlaceFormPanel({
  id,
  form,
  place,
  errors,
  target,
  warning,
  pending,
  busy,
  onChange,
  onTarget,
  onReview,
  onConfirm,
  onCancelConfirm,
  onClose,
}: {
  id: string;
  form: PlaceForm;
  place: Place | null;
  errors: FieldErrors<PlaceFormField>;
  target: PlacePoint;
  warning: string | null;
  pending: Pending | null;
  busy: boolean;
  onChange: (next: Partial<PlaceForm>) => void;
  onTarget: (target: PlacePoint) => void;
  onReview: () => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onClose: () => void;
}) {
  const field = (name: string) => `lugar-${id}-${name}`;
  const isNew = place === null;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onReview();
      }}
      className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm"
    >
      <p className="font-medium text-stone-900">
        {isNew ? 'Lugar nuevo' : `Editando ${place.name}`}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={field('name')} className="font-medium text-stone-700">
            Nombre
          </label>
          <input
            id={field('name')}
            value={form.name}
            maxLength={80}
            onChange={(event) =>
              isNew
                ? onChange(withName(form, event.target.value))
                : onChange({ name: event.target.value })
            }
            aria-invalid={errors.name ? true : undefined}
            className={inputClass}
          />
          {errors.name ? <p className="text-red-700">{errors.name}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={field('slug')} className="font-medium text-stone-700">
            Identificador
          </label>
          <input
            id={field('slug')}
            value={form.slug}
            maxLength={60}
            readOnly={!isNew}
            onChange={(event) => onChange({ slug: event.target.value, slugTouched: true })}
            aria-invalid={errors.slug ? true : undefined}
            className={`${inputClass} font-mono ${isNew ? '' : 'bg-stone-100'}`}
          />
          {errors.slug ? (
            <p className="text-red-700">{errors.slug}</p>
          ) : (
            <p className="text-xs text-stone-500">
              {isNew
                ? 'Se sugiere desde el nombre. No se puede cambiar después.'
                : 'El identificador no se cambia.'}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={field('category')} className="font-medium text-stone-700">
            Categoría
          </label>
          <select
            id={field('category')}
            value={form.category}
            onChange={(event) => onChange({ category: event.target.value as PlaceCategory })}
            className={inputClass}
          >
            {PLACE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {PLACE_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium text-stone-700">Ubicación</legend>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Qué ubica el clic en el mapa"
        >
          <button
            type="button"
            aria-pressed={target === 'location'}
            onClick={() => onTarget('location')}
            className={pointButton(target === 'location')}
          >
            Ubicar el lugar
          </button>
          <button
            type="button"
            aria-pressed={target === 'pickup'}
            onClick={() => onTarget('pickup')}
            className={pointButton(target === 'pickup')}
          >
            {form.pickupPoint ? 'Mover el punto de recogida' : 'Agregar punto de recogida'}
          </button>
          {form.pickupPoint ? (
            <button
              type="button"
              onClick={() => {
                onChange({ pickupPoint: null });
                onTarget('location');
              }}
              className={pointButton(false)}
            >
              Quitar punto de recogida
            </button>
          ) : null}
          {isNew && !form.location ? (
            <button
              type="button"
              onClick={() => onChange({ location: PLACES.VILLAGARZON_CENTER })}
              className={pointButton(false)}
            >
              Empezar en el centro
            </button>
          ) : null}
        </div>
        <p className="text-stone-700">
          Lugar: {form.location ? formatLatLng(form.location) : 'haz clic en el mapa para ubicarlo'}
          {form.pickupPoint ? ` · Recogida: ${formatLatLng(form.pickupPoint)}` : ''}
        </p>
        <p className="text-xs text-stone-500">
          Haz clic en el mapa para poner{' '}
          {target === 'location' ? 'el lugar' : 'el punto de recogida'} o arrastra su marcador. El
          punto de recogida es opcional (portería, parqueadero).
        </p>
        {errors.location ? <p className="text-red-700">{errors.location}</p> : null}
        {errors.pickupPoint ? <p className="text-red-700">{errors.pickupPoint}</p> : null}
        {warning ? <p className="text-amber-900">{warning}</p> : null}
        {place ? (
          <p className="text-stone-700">
            Barrio o vereda (calculado por PANTER): {placeAreaText(place)}. Se recalcula al guardar.
          </p>
        ) : null}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={field('source')} className="font-medium text-stone-700">
            Fuente de la ubicación
          </label>
          <input
            id={field('source')}
            value={form.source}
            maxLength={200}
            placeholder="p. ej. GPS en sitio, 21 nov 2026"
            onChange={(event) => onChange({ source: event.target.value })}
            aria-invalid={errors.source ? true : undefined}
            className={inputClass}
          />
          {errors.source ? <p className="text-red-700">{errors.source}</p> : null}
        </div>
        <label className="flex items-center gap-2 self-end pb-2 font-medium text-stone-700">
          <input
            type="checkbox"
            checked={form.verified}
            onChange={(event) => onChange({ verified: event.target.checked })}
            className="h-4 w-4 accent-emerald-700"
          />
          Ubicación verificada en sitio
        </label>
      </div>

      {pending ? (
        <ConfirmChanges
          id={field('confirmar')}
          title={pending.title}
          changes={pending.changes}
          warnings={pending.warnings}
          busy={busy}
          onConfirm={onConfirm}
          onCancel={onCancelConfirm}
        />
      ) : (
        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"
          >
            {isNew ? 'Revisar y crear' : 'Guardar cambios'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-stone-300 bg-white px-4 py-2 font-medium text-stone-700 hover:bg-stone-100"
          >
            Cancelar
          </button>
        </div>
      )}
    </form>
  );
}

function pointButton(active: boolean): string {
  return `rounded-lg border px-3 py-1.5 font-medium ${
    active
      ? 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800'
      : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
  }`;
}
