'use client';

import type { CatalogHistoryResponse } from '@panter/contracts';
import { useState } from 'react';
import { handleAdminFailure } from '@/features/admin/lib/admin-failure';
import { DiffList } from '@/features/fares/components/form-fields';
import { toApiError } from '@/shared/api/errors';
import { formatDate } from '@/shared/lib/format';
import {
  appendCatalogPage,
  CATALOG_ACTION_LABEL,
  catalogChangeAuthor,
  catalogDiff,
  type CatalogHistoryState,
  type ValueLabels,
} from '../lib/catalog-history';
import { catalogFailureMessage } from '../lib/messages';

/**
 * Historial de un barrio, vereda o lugar (E15), bajo demanda: autor, fecha (hora de Colombia),
 * tipo de cambio y diff campo por campo. `load` pide una página al BFF.
 */
export function CatalogHistory({
  load,
  returnTo,
  labels,
}: {
  load: (cursor?: string) => Promise<CatalogHistoryResponse>;
  returnTo: string;
  labels?: ValueLabels;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<CatalogHistoryState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchPage(cursor?: string) {
    setBusy(true);
    setError(null);
    try {
      const page = await load(cursor);
      setList((current) => (current && cursor ? appendCatalogPage(current, page) : page));
    } catch (failure) {
      handleAdminFailure(
        failure,
        returnTo,
        () => catalogFailureMessage(toApiError(failure)),
        setError,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && !list) void fetchPage();
        }}
        className="self-start text-sm font-medium text-emerald-800 underline"
      >
        {open ? 'Ocultar historial' : 'Ver historial'}
      </button>
      {open ? (
        <div aria-live="polite" className="flex flex-col gap-2">
          {list && list.items.length === 0 ? (
            <p className="text-sm text-stone-600">Todavía no hay cambios registrados.</p>
          ) : null}
          {list && list.items.length > 0 ? (
            <ol className="flex flex-col gap-2">
              {list.items.map((change) => {
                const fields = catalogDiff(change.before, change.after, labels);
                return (
                  <li key={change.id} className="rounded-lg border border-stone-200 p-3">
                    <p className="mb-1 text-xs text-stone-500">
                      <span className="font-semibold text-stone-800">
                        {CATALOG_ACTION_LABEL[change.action]}
                      </span>{' '}
                      · {catalogChangeAuthor(change)} · {formatDate(change.changedAt)} (hora de
                      Colombia)
                    </p>
                    {fields.length > 0 ? (
                      <DiffList changes={fields} />
                    ) : (
                      <p className="text-sm text-stone-500">Sin cambios en los valores.</p>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          {busy ? <p className="text-sm text-stone-500">Cargando…</p> : null}
          {list?.nextCursor && !busy ? (
            <button
              type="button"
              onClick={() => void fetchPage(list.nextCursor ?? undefined)}
              className="self-start rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              Cargar más
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
