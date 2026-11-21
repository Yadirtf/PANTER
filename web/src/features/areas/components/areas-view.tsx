import type { AreasResponse } from '@panter/contracts';
import type { ServerLoad } from '@/features/auth/server/server-load';
import { catalogErrorMessage } from '@/features/catalog/lib/messages';
import { AreasEditor } from './areas-editor';

type Shown<T> = Extract<ServerLoad<T>, { kind: 'ok' | 'error' }>;

/** Contenido de /admin/barrios según la carga del servidor (Server Component). */
export function AreasView({ areas }: { areas: Shown<AreasResponse> }) {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase">
          Panel administrativo
        </p>
        <h1 className="text-3xl font-bold text-stone-900">Barrios y veredas</h1>
        <p className="text-stone-600">
          Límites de los barrios del casco urbano y de las veredas de Villagarzón. Con ellos PANTER
          describe el origen y el destino de cada viaje («Barrio Centro · cerca del Parque
          principal»). Cada cambio queda en el historial con quién lo hizo y cuándo.
        </p>
      </div>
      {areas.kind === 'ok' ? (
        <AreasEditor areas={areas.data.items} />
      ) : (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {catalogErrorMessage(areas.code)}
        </p>
      )}
    </main>
  );
}
