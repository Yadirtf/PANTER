import type { FareConfigResponse, Place } from '@panter/contracts';
import type { ServerLoad } from '@/features/auth/server/server-load';
import { fareErrorMessage } from '../lib/messages';
import type { FareHistoryResponse } from '../server/fares-api';
import { FareHistory } from './fare-history';
import { FaresEditor } from './fares-editor';

type Shown<T> = Extract<ServerLoad<T>, { kind: 'ok' | 'error' }>;

/** Contenido de /admin/tarifas según la carga del servidor (Server Component). */
export function FaresView({
  config,
  history,
  places = [],
}: {
  config: Shown<FareConfigResponse>;
  history: Shown<FareHistoryResponse>;
  /** Lugares del catálogo (GET /places) para el mapa; vacío si no cargaron. */
  places?: readonly Place[];
}) {
  const geofences = config.kind === 'ok' ? config.data.geofences : [];
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase">
          Panel administrativo
        </p>
        <h1 className="text-3xl font-bold text-stone-900">Tarifas</h1>
        <p className="text-stone-600">
          Ajusta las tarifas por tipo de vehículo y los recargos por zona sin desplegar código. Los
          valores son pesos colombianos y el horario nocturno usa la hora de Colombia. Cada cambio
          queda en el historial con quién lo hizo y cuándo.
        </p>
      </div>

      {config.kind === 'ok' ? (
        <FaresEditor config={config.data} places={places} />
      ) : (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {fareErrorMessage(config.code)}
        </p>
      )}

      <section aria-labelledby="historial" className="flex flex-col gap-4">
        <h2 id="historial" className="text-xl font-semibold text-stone-900">
          Historial de cambios
        </h2>
        {history.kind === 'ok' ? (
          // La clave cambia cuando llega un cambio nuevo (router.refresh tras guardar).
          <FareHistory
            key={history.data.items[0]?.id ?? 'vacio'}
            initial={history.data}
            geofences={geofences}
          />
        ) : (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-800">
            {fareErrorMessage(history.code)}
          </p>
        )}
      </section>
    </main>
  );
}
