'use client';

import type { ReactNode } from 'react';
import type { FieldChange } from '../lib/history';
import { formatMoneyInput } from '../lib/fares';

export const inputClass =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 focus:outline-none aria-[invalid=true]:border-red-500';

function FieldShell({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-stone-700">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-stone-500">{hint}</p>
      ) : null}
    </div>
  );
}

/** Monto en COP: entrada numérica con "$" y puntos de miles mientras se escribe ("$ 3.000"). */
export function MoneyField({
  id,
  label,
  value,
  error,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  hint?: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-stone-500"
        >
          $
        </span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(formatMoneyInput(event.target.value))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${inputClass} pl-7 text-right tabular-nums`}
        />
      </div>
    </FieldShell>
  );
}

/** Hora del día en 24 h ("20:00"); se convierte a minutos al guardar. */
export function TimeField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <FieldShell id={id} label={label} error={error}>
      <input
        id={id}
        type="time"
        step={60}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={inputClass}
      />
    </FieldShell>
  );
}

/** Lista "campo: antes → después" (confirmación antes de guardar y también el historial). */
export function DiffList({ changes }: { changes: readonly FieldChange[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {changes.map((change) => (
        <li key={change.field}>
          <span className="font-medium text-stone-800">{change.label}:</span>{' '}
          <del className="text-red-800 decoration-red-400">{change.before}</del>{' '}
          <span aria-hidden="true">→</span>
          <span className="sr-only">cambió a</span>{' '}
          <ins className="font-semibold text-emerald-800 no-underline">{change.after}</ins>
        </li>
      ))}
    </ul>
  );
}
