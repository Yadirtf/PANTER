'use client';

import { AREA_KIND_LABELS, type AreaKind } from '@panter/contracts';
import { DiffList, inputClass } from '@/features/fares/components/form-fields';
import type { FieldErrors } from '@/features/fares/lib/fares';
import type { FieldChange } from '@/features/fares/lib/history';
import { AREA_KINDS, type AreaForm, type AreaFormField } from '../lib/areas';

/** Campos de un barrio o vereda (nombre, tipo y fuente) con la confirmación del diff. */
export function AreaFormFields({
  idPrefix,
  form,
  errors,
  onChange,
}: {
  idPrefix: string;
  form: AreaForm;
  errors: FieldErrors<AreaFormField>;
  onChange: (next: Partial<AreaForm>) => void;
}) {
  const id = (field: string) => `${idPrefix}-${field}`;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={id('name')} className="text-sm font-medium text-stone-700">
          Nombre
        </label>
        <input
          id={id('name')}
          value={form.name}
          maxLength={80}
          onChange={(event) => onChange({ name: event.target.value })}
          aria-invalid={errors.name ? true : undefined}
          className={inputClass}
        />
        {errors.name ? <p className="text-sm text-red-700">{errors.name}</p> : null}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={id('kind')} className="text-sm font-medium text-stone-700">
          Tipo
        </label>
        <select
          id={id('kind')}
          value={form.kind}
          onChange={(event) => onChange({ kind: event.target.value as AreaKind })}
          className={inputClass}
        >
          {AREA_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {AREA_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        {errors.kind ? <p className="text-sm text-red-700">{errors.kind}</p> : null}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={id('source')} className="text-sm font-medium text-stone-700">
          Fuente del límite
        </label>
        <input
          id={id('source')}
          value={form.source}
          maxLength={200}
          placeholder="p. ej. Alcaldía – POT 2024"
          onChange={(event) => onChange({ source: event.target.value })}
          aria-invalid={errors.source ? true : undefined}
          className={inputClass}
        />
        {errors.source ? <p className="text-sm text-red-700">{errors.source}</p> : null}
      </div>
    </div>
  );
}

/** Diálogo "¿Guardar estos cambios?" con el diff y los botones Confirmar/Cancelar. */
export function ConfirmChanges({
  id,
  title,
  changes,
  warnings = [],
  busy,
  onConfirm,
  onCancel,
}: {
  id: string;
  title: string;
  changes: readonly FieldChange[];
  warnings?: readonly string[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-labelledby={id}
      className="rounded-lg border border-amber-300 bg-amber-50 p-3"
    >
      <p id={id} className="mb-2 font-medium text-stone-900">
        {title}
      </p>
      <DiffList changes={changes} />
      {warnings.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-amber-900">
          {warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {busy ? 'Guardando…' : 'Confirmar'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
