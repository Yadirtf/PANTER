import type { PlacesResponse } from '@panter/contracts';
import type { ServerLoad } from '@/features/auth/server/server-load';
import { placeFailureMessage } from '@/features/catalog/lib/messages';
import { PlacesEditor } from './places-editor';

type Shown<T> = Extract<ServerLoad<T>, { kind: 'ok' | 'error' }>;

/** Contenido de /admin/lugares según la carga del servidor (Server Component). */
export function PlacesView({ places }: { places: Shown<PlacesResponse> }) {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase">
          Panel administrativo
        </p>
        <h1 className="text-3xl font-bold text-stone-900">Lugares</h1>
        <p className="text-stone-600">
          Catálogo de lugares de interés (aeropuerto, parque, hospital, terminal, sitios
          turísticos…) con su ubicación real, para que pasajeros y conductores los encuentren. Los
          que no se han confirmado en sitio quedan marcados «Sin verificar». Cada cambio queda en el
          historial.
        </p>
      </div>
      {places.kind === 'ok' ? (
        <PlacesEditor places={places.data.items} />
      ) : (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {placeFailureMessage({ code: places.code, message: '' })}
        </p>
      )}
    </main>
  );
}
