'use client';

import type { LatLng } from '@panter/contracts';
import { useEffect } from 'react';
import { usePanterMap } from '@/features/map/components/map-context';
import { boundsOf } from '../lib/polygon-map';

/** Petición de centrar el mapa en unos puntos; `at` distingue dos peticiones iguales. */
export interface FitTarget {
  points: readonly LatLng[];
  at: number;
}

/** Centra el mapa en los puntos (un polígono o un lugar) cada vez que cambia `target`. */
export function FitBounds({
  target,
  maxZoom = 16,
}: {
  target: FitTarget | null;
  maxZoom?: number;
}) {
  const map = usePanterMap()?.map;
  useEffect(() => {
    if (!map || !target) return;
    const bounds = boundsOf(target.points);
    if (!bounds) return;
    map.fitBounds(bounds, { padding: 48, maxZoom, duration: 600 });
  }, [map, target, maxZoom]);
  return null;
}
