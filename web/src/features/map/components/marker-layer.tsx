'use client';

import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import {
  frameAt,
  HEADING_ARROW_ICON,
  headingArrowImage,
  MARKER_STATUS_COLOR,
  markersToFeatureCollection,
  planTransition,
  transitionMoves,
  type MapMarker,
} from '../lib/markers';
import { removeLayers, useLatest, usePanterMap } from './map-context';

export interface MarkerLayerProps {
  /** Prefijo de la fuente y las capas (para tener varias capas de marcadores). */
  id?: string;
  markers: readonly MapMarker[];
  /** Desliza los marcadores entre posiciones (por defecto sí, salvo "reducir movimiento"). */
  animate?: boolean;
  /** Duración de la animación entre dos posiciones, en ms. */
  durationMs?: number;
  onMarkerClick?: (id: string) => void;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const STATUS_COLOR_EXPRESSION = [
  'match',
  ['get', 'status'],
  ...Object.entries(MARKER_STATUS_COLOR).flat(),
  '#78716c',
];

/**
 * Marcadores de vehículos con los íconos de map-style (mototaxi, taxi, 4x4). Todo va en UNA
 * fuente GeoJSON que se actualiza con setData (no un marcador DOM por vehículo), así aguanta la
 * flota en vivo de HU-504 con decenas de conductores. Anillo de color por estado y flecha de
 * rumbo opcional.
 */
export function MarkerLayer({
  id = 'panter-markers',
  markers,
  animate = true,
  durationMs = 1000,
  onMarkerClick,
}: MarkerLayerProps) {
  const handle = usePanterMap();
  const map = handle?.map;
  const revision = handle?.styleRevision;
  const rendered = useRef<readonly MapMarker[]>([]);
  const frame = useRef<number | null>(null);
  const onClick = useLatest(onMarkerClick);
  const ids = { source: id, ring: `${id}-ring`, icon: `${id}-icon`, heading: `${id}-heading` };

  // Fuente y capas: al crear el mapa y tras cada cambio de estilo (tema).
  useEffect(() => {
    if (!map) return;
    if (!map.hasImage(HEADING_ARROW_ICON)) {
      map.addImage(HEADING_ARROW_ICON, headingArrowImage(2), { pixelRatio: 2 });
    }
    map.addSource(ids.source, {
      type: 'geojson',
      data: markersToFeatureCollection(rendered.current),
    });
    map.addLayer({
      id: ids.ring,
      type: 'circle',
      source: ids.source,
      paint: {
        'circle-radius': 19,
        'circle-color': '#ffffff',
        'circle-opacity': 0.35,
        'circle-stroke-width': 3,
        'circle-stroke-color': STATUS_COLOR_EXPRESSION as never,
      },
    });
    map.addLayer({
      id: ids.icon,
      type: 'symbol',
      source: ids.source,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['match', ['get', 'status'], 'OFFLINE', 0.5, 1] },
    });
    map.addLayer({
      id: ids.heading,
      type: 'symbol',
      source: ids.source,
      filter: ['==', ['get', 'hasHeading'], true],
      layout: {
        'icon-image': HEADING_ARROW_ICON,
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-offset': [0, -26],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });

    const click = (event: MapLayerMouseEvent) => {
      const markerId = event.features?.[0]?.properties?.id;
      if (typeof markerId === 'string') onClick.current?.(markerId);
    };
    const enter = () => {
      if (onClick.current) map.getCanvas().style.cursor = 'pointer';
    };
    const leave = () => {
      map.getCanvas().style.cursor = '';
    };
    map.on('click', ids.icon, click);
    map.on('mouseenter', ids.icon, enter);
    map.on('mouseleave', ids.icon, leave);
    return () => {
      map.off('click', ids.icon, click);
      map.off('mouseenter', ids.icon, enter);
      map.off('mouseleave', ids.icon, leave);
      removeLayers(map, [ids.heading, ids.icon, ids.ring], [ids.source]);
    };
  }, [map, revision, id]);

  // Datos: setData directo o animado entre la posición dibujada y la nueva.
  useEffect(() => {
    const source = map?.getSource(ids.source) as GeoJSONSource | undefined;
    if (!source) return;
    const draw = (list: readonly MapMarker[]) => {
      rendered.current = list;
      void source.setData(markersToFeatureCollection(list));
    };
    const transition = planTransition(rendered.current, markers);
    if (!animate || durationMs <= 0 || prefersReducedMotion() || !transitionMoves(transition)) {
      draw(markers);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / durationMs;
      draw(t >= 1 ? markers : frameAt(transition, t));
      frame.current = t >= 1 ? null : requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [map, revision, id, markers, animate, durationMs]);

  return null;
}
