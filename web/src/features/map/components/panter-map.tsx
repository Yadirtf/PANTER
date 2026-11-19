'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import type { MapThemePreference } from '../lib/theme';
import { MapLoading } from './map-loading';

export interface PanterMapProps {
  /** Nombre accesible del mapa (p. ej. "Mapa de geocercas de Villagarzón"). */
  ariaLabel: string;
  /** Alto del mapa (clases de Tailwind). Por defecto `h-96`. */
  className?: string;
  /** 'auto' (por defecto) sigue la hora de Colombia: oscuro de 8:00 p. m. a 5:00 a. m. */
  theme?: MapThemePreference;
  /** Capas del mapa: <MarkerLayer>, capas propias con usePanterMap()… */
  children?: ReactNode;
}

/**
 * maplibre-gl y pmtiles solo se cargan en el navegador: import dinámico sin SSR, así no entran
 * al bundle del Worker de OpenNext ni se ejecutan en el servidor (no hay WebGL ni window).
 */
const MapCanvas = dynamic(() => import('./map-canvas').then((m) => m.MapCanvas), {
  ssr: false,
  loading: () => <MapLoading />,
});

/**
 * Mapa de PANTER (HU-304): mapa base propio (.pmtiles de panter-api), estilo de map-style con
 * tema claro u oscuro según la hora de Colombia, límites del área de servicio y controles de
 * zoom. Las capas se pasan como hijos.
 */
export function PanterMap({ ariaLabel, className, theme = 'auto', children }: PanterMapProps) {
  return (
    // Sin role propio: MapLibre ya da al lienzo role="region" con este mismo nombre (Map.Title).
    <div
      data-panter-map={ariaLabel}
      className={`relative w-full overflow-hidden rounded-xl border border-stone-200 ${className ?? 'h-96'}`}
    >
      <MapCanvas ariaLabel={ariaLabel} theme={theme}>
        {children}
      </MapCanvas>
    </div>
  );
}
