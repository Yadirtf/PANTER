'use client';

import type { Geofence } from '@panter/contracts';
import { useState } from 'react';
import { handleAdminFailure } from '@/features/admin/lib/admin-failure';
import { formatDate } from '@/shared/lib/format';
import { fetchHistoryPage } from '../api/fares-client';
import { ADMIN_FARES_PATH } from '../lib/fares';
import {
  appendHistoryPage,
  changeAuthor,
  changeKind,
  changeTitle,
  diffSnapshots,
  type HistoryState,
} from '../lib/history';
import { fareErrorMessage } from '../lib/messages';
import { DiffList } from './form-fields';

/** Historial de cambios: autor, fecha (hora de Colombia) y diff campo por campo. */
export function FareHistory({
  initial,
  geofences,
}: {
  initial: HistoryState;
  geofences: readonly Geofence[];
}) {
  const [list, setList] = useState<HistoryState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!list.nextCursor) return;
    setBusy(true);
    setError(null);
    try {
      const page = await fetchHistoryPage(list.nextCursor);
      setList((current) => appendHistoryPage(current, page));
    } catch (failure) {
      handleAdminFailure(failure, ADMIN_FARES_PATH, fareErrorMessage, setError);
    } finally {
      setBusy(false);
    }
  }

  if (list.items.length === 0) {
    return <p className="text-stone-600">Todavía no hay cambios registrados.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {list.items.map((change) => {
          const fields = diffSnapshots(change.before, change.after);
          return (
            <li key={change.id} className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-stone-900">
                  {changeTitle(change, geofences)}{' '}
                  <span className="text-xs font-normal text-stone-500">({changeKind(change)})</span>
                </p>
                <p className="text-xs text-stone-500">
                  {changeAuthor(change)} · {formatDate(change.changedAt)} (hora de Colombia)
                </p>
              </div>
              {fields.length > 0 ? (
                <DiffList changes={fields} />
              ) : (
                <p className="text-sm text-stone-500">Sin cambios en los valores.</p>
              )}
            </li>
          );
        })}
      </ol>
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {list.nextCursor ? (
        <button
          type="button"
          disabled={busy}
          onClick={loadMore}
          className="self-center rounded-lg border border-stone-300 px-4 py-2 font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
        >
          {busy ? 'Cargando…' : 'Cargar más'}
        </button>
      ) : null}
    </div>
  );
}
