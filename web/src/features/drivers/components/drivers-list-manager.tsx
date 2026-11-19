'use client';

import type { AdminDriversResponse } from '@panter/contracts';
import Link from 'next/link';
import { useState } from 'react';
import { handleAdminFailure } from '@/features/admin/lib/admin-failure';
import { formatDate, VEHICLE_LABEL } from '@/shared/lib/format';
import { fetchDriversPage } from '../api/drivers-client';
import {
  adminDriverDetailPath,
  appendDriversPage,
  documentsSummary,
  DRIVER_STATUS_LABEL,
  driverName,
  driversListPath,
  formatPlate,
  statusForApi,
  vehicleDescription,
  type DriversFilter,
  type DriversListState,
} from '../lib/drivers';
import { driverErrorMessage } from '../lib/messages';

/** Tabla de solicitudes de conductor con "Cargar más" (cursor). */
export function DriversListManager({
  filter,
  initial,
}: {
  filter: DriversFilter;
  initial: AdminDriversResponse;
}) {
  const [list, setList] = useState<DriversListState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!list.nextCursor) return;
    setBusy(true);
    setError(null);
    try {
      const page = await fetchDriversPage({
        status: statusForApi(filter),
        cursor: list.nextCursor,
      });
      setList((current) => appendDriversPage(current, page));
    } catch (failure) {
      handleAdminFailure(failure, driversListPath(filter), driverErrorMessage, setError);
    } finally {
      setBusy(false);
    }
  }

  if (list.items.length === 0) {
    return <p className="text-stone-600">No hay solicitudes en este estado.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50 text-stone-600">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">
                Solicitante
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Vehículo
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Documentos
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Solicitud
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {list.items.map((driver) => {
              const docs = documentsSummary(driver);
              return (
                <tr key={driver.userId} className="align-top">
                  <td className="px-4 py-3">
                    <Link
                      href={adminDriverDetailPath(driver.userId)}
                      className="font-medium break-all text-emerald-800 hover:underline"
                    >
                      {driverName(driver)}
                    </Link>
                    {driver.fullName ? (
                      <p className="text-xs break-all text-stone-500">{driver.email}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-stone-600">
                      {DRIVER_STATUS_LABEL[driver.verificationStatus]}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-stone-700">
                    <p>
                      <span className="font-medium">
                        {VEHICLE_LABEL[driver.vehicle.vehicleType]}
                      </span>{' '}
                      ·{' '}
                      <span className="font-mono font-semibold tracking-wider">
                        {formatPlate(driver.vehicle.plate)}
                      </span>
                    </p>
                    <p className="text-xs text-stone-500">{vehicleDescription(driver.vehicle)}</p>
                  </td>
                  <td className="px-4 py-3 text-stone-700">
                    <p>
                      {docs.uploaded} de {docs.required} subidos · {docs.approved} aprobados
                    </p>
                    {docs.missing.length > 0 ? (
                      <p className="text-xs text-amber-800">Faltan: {docs.missing.join(', ')}</p>
                    ) : (
                      <p className="text-xs text-stone-500">Todos los documentos subidos</p>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-stone-700">
                    {formatDate(driver.appliedAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
