'use client';

import type { FareRuleUpdateBody, Geofence, VehicleType } from '@panter/contracts';
import { formatCop, VEHICLE_LABEL } from '@/shared/lib/format';
import {
  approximateTrip,
  AVERAGE_SPEED_KMH,
  estimateFare,
  PREVIEW_CASES,
  ROUTE_FACTOR,
  type PreviewCase,
} from '../lib/estimate';

export type PreviewRule =
  | { kind: 'ok'; body: FareRuleUpdateBody; dirty: boolean }
  | { kind: 'invalid' }
  | { kind: 'missing' };

export const PREVIEW_DISCLAIMER = `Aproximación sin ruta real: la distancia es la línea recta por ${String(ROUTE_FACTOR).replace('.', ',')} y el tiempo supone ${AVERAGE_SPEED_KMH} km/h. El valor que verá el pasajero lo calcula la API con la ruta de OpenRouteService.`;

/** Vista previa con 3 casos fijos, calculada en el navegador con la regla que se está editando. */
export function FarePreview({
  rules,
  geofences,
}: {
  rules: Partial<Record<VehicleType, PreviewRule>>;
  geofences: readonly Geofence[];
}) {
  return (
    <section
      aria-labelledby="vista-previa"
      className="flex flex-col gap-4 rounded-xl border border-sky-200 bg-sky-50 p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="vista-previa" className="text-xl font-semibold text-stone-900">
          Vista previa del estimado
        </h2>
        <p className="text-sm text-sky-900">{PREVIEW_DISCLAIMER}</p>
      </div>
      <ul className="grid gap-4 md:grid-cols-3">
        {PREVIEW_CASES.map((preview) => {
          const rule = rules[preview.vehicleType] ?? { kind: 'missing' };
          const vehicle = VEHICLE_LABEL[preview.vehicleType];
          return (
            <li
              key={preview.id}
              data-case={preview.id}
              className="flex flex-col gap-2 rounded-lg border border-sky-200 bg-white p-3"
            >
              <h3 className="font-semibold text-stone-900">{preview.title}</h3>
              <p className="text-xs text-stone-500">{preview.description}</p>
              {rule.kind === 'missing' ? (
                <p className="text-sm text-stone-600">No hay tarifa de {vehicle}.</p>
              ) : rule.kind === 'invalid' ? (
                <p className="text-sm text-amber-800">
                  Corrige los campos de la tarifa de {vehicle} para ver la vista previa.
                </p>
              ) : (
                <CaseResult
                  preview={preview}
                  body={rule.body}
                  dirty={rule.dirty}
                  geofences={geofences}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CaseResult({
  preview,
  body,
  dirty,
  geofences,
}: {
  preview: PreviewCase;
  body: FareRuleUpdateBody;
  dirty: boolean;
  geofences: readonly Geofence[];
}) {
  const estimate = estimateFare(
    { ...body, vehicleType: preview.vehicleType },
    geofences,
    approximateTrip(preview),
  );
  return (
    <>
      <dl className="flex flex-col gap-1 text-sm">
        {estimate.breakdown.map((component, index) => (
          <div key={`${component.code}-${index}`} className="flex justify-between gap-2">
            <dt className="text-stone-600">{component.label}</dt>
            <dd className="text-stone-900 tabular-nums">{formatCop(component.amount)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-2 border-t border-stone-200 pt-1 font-semibold">
          <dt>Total aproximado</dt>
          <dd className="tabular-nums">{formatCop(estimate.total)}</dd>
        </div>
      </dl>
      {dirty ? <p className="text-xs text-amber-800">Con cambios sin guardar.</p> : null}
      {!body.active ? (
        <p className="text-xs text-red-800">Tarifa inactiva: la API no ofrecería este viaje.</p>
      ) : null}
    </>
  );
}
