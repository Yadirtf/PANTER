'use client';

import { PLACE_CATEGORY_LABELS, type LatLng } from '@panter/contracts';
import { useEffect, useState } from 'react';
import type { PublicPlacesLoad } from '@/features/catalog/server/load-catalog';
import { CatalogPlacesLayer } from '@/features/map/components/catalog-places-layer';
import { usePanterMap } from '@/features/map/components/map-context';
import { MarkerLayer } from '@/features/map/components/marker-layer';
import { PanterMap } from '@/features/map/components/panter-map';
import type { MapMarker } from '@/features/map/lib/markers';

export const PLACES_UNAVAILABLE_NOTE =
  'No pudimos cargar los lugares del catálogo. El mapa funciona igual; recarga la página en un momento.';
export const UNVERIFIED_NOTE = 'Ubicación aproximada, por verificar en campo';

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

/**
 * Panel de despacho (/despacho): mapa con los lugares del catálogo (GET /places, HU-310), listo
 * para la flota de HU-504.
 */
export function DispatchConsole({ places }: { places: PublicPlacesLoad }) {
  const list = places.kind === 'ok' ? places.places : [];
  const [target, setTarget] = useState<{ position: LatLng; at: number } | null>(null);
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase">
          Panel de despacho
        </p>
        <h1 className="text-3xl font-bold text-stone-900">Despacho</h1>
        <p className="text-stone-600">
          Mapa de Villagarzón con los lugares del catálogo. {FLEET_PENDING_NOTE} La asignación
          manual de viajes y las alertas SOS llegan en sus propias historias.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <PanterMap ariaLabel="Mapa de despacho de Villagarzón" className="h-[32rem]">
          <CatalogPlacesLayer
            places={list}
            onPlaceClick={(id) => {
              const place = list.find((p) => p.id === id);
              if (place) setTarget({ position: place.location, at: Date.now() });
            }}
          />
          <MarkerLayer id="panter-fleet" markers={NO_FLEET} />
          <FlyTo target={target} />
        </PanterMap>
        <section aria-labelledby="lugares-clave" className="flex flex-col gap-2">
          <h2 id="lugares-clave" className="text-lg font-semibold text-stone-900">
            Lugares
          </h2>
          {places.kind === 'error' ? (
            <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {PLACES_UNAVAILABLE_NOTE}
            </p>
          ) : list.length === 0 ? (
            <p className="text-sm text-stone-600">Todavía no hay lugares en el catálogo.</p>
          ) : null}
          <ul className="flex flex-col gap-1 text-sm">
            {list.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => setTarget({ position: place.location, at: Date.now() })}
                  className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-stone-100"
                >
                  <span className="font-medium text-stone-900">{place.name}</span>
                  <span className="block text-xs text-stone-500">
                    {PLACE_CATEGORY_LABELS[place.category]}
                    {place.area ? ` · ${place.area.name}` : ''}
                  </span>
                  {place.verified ? null : (
                    <span className="block text-xs text-amber-800">{UNVERIFIED_NOTE}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
