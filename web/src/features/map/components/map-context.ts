'use client';

import type { Map as MaplibreMap } from 'maplibre-gl';
import type { MapTheme } from '@panter/map-style';
import { createContext, useContext, useEffect, useRef } from 'react';

/**
 * Mapa listo para que las capas (marcadores, geocercas…) agreguen sus fuentes. `styleRevision`
 * cambia cada vez que el estilo se vuelve a cargar (cambio de tema): las capas propias se
 * pierden con el estilo anterior y hay que agregarlas de nuevo.
 *
 * Solo se importan *tipos* de maplibre-gl: la librería vive en el chunk del cliente que carga
 * <PanterMap> con import dinámico.
 */
export interface PanterMapHandle {
  map: MaplibreMap;
  styleRevision: number;
  theme: MapTheme;
}

export const PanterMapContext = createContext<PanterMapHandle | null>(null);

/** El mapa de la <PanterMap> que envuelve al componente, o `null` mientras carga. */
export function usePanterMap(): PanterMapHandle | null {
  return useContext(PanterMapContext);
}

/** Ejecuta `fn` ignorando el error de un mapa ya destruido (al desmontar todo a la vez). */
export function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // El mapa o su estilo ya no existen: no hay nada que limpiar.
  }
}

/** Quita capas y fuentes propias si siguen en el estilo. */
export function removeLayers(
  map: MaplibreMap,
  layers: readonly string[],
  sources: readonly string[],
) {
  safely(() => {
    for (const layer of layers) if (map.getLayer(layer)) map.removeLayer(layer);
    for (const source of sources) if (map.getSource(source)) map.removeSource(source);
  });
}

/** Ref que siempre apunta al último valor (para callbacks de eventos del mapa). */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
