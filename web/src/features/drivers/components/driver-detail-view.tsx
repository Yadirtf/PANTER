import Link from 'next/link';
import { formatDate, VEHICLE_LABEL } from '@/shared/lib/format';
import { ADMIN_DRIVERS_PATH, DRIVER_STATUS_LABEL, driverName, formatPlate } from '../lib/drivers';
import { driverErrorMessage } from '../lib/messages';
import type { DriverDetailLoad } from '../server/load-drivers';
import { DriverReview } from './driver-review';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{label}</dt>
      <dd className="text-stone-900">{value}</dd>
    </div>
  );
}

/** Contenido de /admin/conductores/[userId] (Server Component). */
export function DriverDetailView({
  load,
}: {
  load: Extract<DriverDetailLoad, { kind: 'ok' | 'error' }>;
}) {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
      <Link
        href={ADMIN_DRIVERS_PATH}
        className="text-sm font-medium text-emerald-800 hover:underline"
      >
        ← Volver a conductores
      </Link>
      {load.kind === 'error' ? (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {driverErrorMessage(load.code)}
        </p>
      ) : (
        <DriverDetail data={load.data} />
      )}
    </main>
  );
}

function DriverDetail({ data }: { data: Extract<DriverDetailLoad, { kind: 'ok' }>['data'] }) {
  const { driver } = data;
  const vehicle = driver.vehicle;
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase">
          Solicitud de conductor · {DRIVER_STATUS_LABEL[driver.verificationStatus]}
        </p>
        <h1 className="text-3xl font-bold break-all text-stone-900">{driverName(driver)}</h1>
        {driver.rejectionReason ? (
          <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800">
            Motivo registrado: {driver.rejectionReason}
          </p>
        ) : null}
      </div>
      <dl className="grid gap-4 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-3">
        <Field label="Correo" value={driver.email} />
        <Field label="Teléfono" value={driver.phone ?? '—'} />
        <Field label="Solicitud" value={formatDate(driver.appliedAt)} />
        <Field label="Vehículo" value={VEHICLE_LABEL[vehicle.vehicleType]} />
        <Field label="Placa" value={formatPlate(vehicle.plate)} />
        <Field label="Marca y modelo" value={`${vehicle.brand} ${vehicle.model}`} />
        <Field label="Color" value={vehicle.color} />
        <Field label="Año" value={String(vehicle.year)} />
        <Field
          label="Última revisión"
          value={
            driver.reviewedAt
              ? `${formatDate(driver.reviewedAt)}${driver.reviewedBy ? ` por ${driver.reviewedBy}` : ''}`
              : 'Sin revisar'
          }
        />
      </dl>
      <DriverReview driver={driver} viewUrls={data.viewUrls} />
    </>
  );
}
