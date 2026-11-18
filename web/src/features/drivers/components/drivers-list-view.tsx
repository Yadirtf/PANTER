import Link from 'next/link';
import { FILTERS, driversListPath, type DriversFilter } from '../lib/drivers';
import { driverErrorMessage } from '../lib/messages';
import type { DriversListLoad } from '../server/load-drivers';
import { DriversListManager } from './drivers-list-manager';

/** Contenido de /admin/conductores según la primera carga (Server Component). */
export function DriversListView({
  filter,
  load,
}: {
  filter: DriversFilter;
  load: Extract<DriversListLoad, { kind: 'ok' | 'error' }>;
}) {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase">
          Panel administrativo
        </p>
        <h1 className="text-3xl font-bold text-stone-900">Conductores</h1>
        <p className="text-stone-600">
          Revisa los documentos de cada solicitud y aprueba, rechaza o suspende conductores. Solo
          quien tenga sus 5 documentos aprobados puede recibir el rol de conductor.
        </p>
      </div>

      <nav aria-label="Filtrar por estado">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map((option) => {
            const active = option.value === filter;
            return (
              <li key={option.value}>
                <Link
                  href={driversListPath(option.value)}
                  aria-current={active ? 'page' : undefined}
                  className={
                    active
                      ? 'inline-block rounded-full bg-emerald-700 px-4 py-1.5 text-sm font-semibold text-white'
                      : 'inline-block rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100'
                  }
                >
                  {option.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {load.kind === 'ok' ? (
        <DriversListManager key={filter} filter={filter} initial={load.data} />
      ) : (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {driverErrorMessage(load.code)}
        </p>
      )}
    </main>
  );
}
