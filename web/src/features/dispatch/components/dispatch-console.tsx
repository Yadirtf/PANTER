'use client';

import type { LatLng } from '@panter/contracts';
import { KEY_PLACES } from '@panter/map-style';
import { useEffect, useState } from 'react';
import { usePanterMap } from '@/features/map/components/map-context';
import { MarkerLayer } from '@/features/map/components/marker-layer';
import { PanterMap } from '@/features/map/components/panter-map';
import type { MapMarker } from '@/features/map/lib/markers';

export const FLEET_PENDING_NOTE =
  'La flota en vivo (conductores conectados y su estado) aparecerá en este mapa con HU-504.';

/** Conductores en el mapa: vacío hasta que HU-504 conecte la flota en vivo. */
const NO_FLEET: readonly MapMarker[] = [];

/** Centra el mapa en un lugar cuando cambia `target`. */
function FlyTo({ target }: { target: { position: LatLng; at: number } | null }) {
  const map = usePanterMap()?.map;
  useEffect(() => {
    if (!map || !target) return;
    map.flyTo({ center: [target.position.lng, target.position.lat], zoom: 14 });
  }, [map, target]);
  return null;
}

/** Panel de despacho (/despacho): mapa con los lugares clave, listo para la flota de HU-504. */
export function DispatchConsole() {
  const [target, setTarget] = useState<{ position: LatLng; at: number } | null>(null);
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase">
          Panel de despacho
        </p>
        <h1 className="text-3xl font-bold text-stone-900">Despacho</h1>
        <p className="text-stone-600">
          Mapa de Villagarzón con los lugares clave. {FLEET_PENDING_NOTE} La asignación manual de
          viajes y las alertas SOS llegan en sus propias historias.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <PanterMap ariaLabel="Mapa de despacho de Villagarzón" className="h-[32rem]">
          <MarkerLayer id="panter-fleet" markers={NO_FLEET} />
          <FlyTo target={target} />
        </PanterMap>
        <section aria-labelledby="lugares-clave" className="flex flex-col gap-2">
          <h2 id="lugares-clave" className="text-lg font-semibold text-stone-900">
            Lugares clave
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {KEY_PLACES.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => setTarget({ position: place.position, at: Date.now() })}
                  className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-stone-100"
                >
                  <span className="font-medium text-stone-900">{place.name}</span>
                  {place.approximate ? (
                    <span className="block text-xs text-stone-500">
                      Ubicación aproximada, por verificar en campo
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
