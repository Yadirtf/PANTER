'use client';

import type { LatLng } from '@panter/contracts';
import type {
  GeoJSONSource,
  MapLayerMouseEvent,
  MapLayerTouchEvent,
  MapMouseEvent,
  MapTouchEvent,
} from 'maplibre-gl';
import { useEffect } from 'react';
import { removeLayers, useLatest, usePanterMap } from '@/features/map/components/map-context';

export type PlacePoint = 'location' | 'pickup';

const SRC = 'panter-place-edit';
const LAYER = { link: 'panter-place-edit-link', points: 'panter-place-edit-points' } as const;

/** Color del marcador del lugar y del punto de recogida. */
export const PLACE_POINT_COLOR: Record<PlacePoint, string> = {
  location: '#dc2626',
  pickup: '#2563eb',
};

/** Marcadores del lugar en edición como GeoJSON (con la línea que une lugar y recogida). */
export function placeEditFeatureCollection(location: LatLng | null, pickup: LatLng | null) {
  const point = (p: LatLng, which: PlacePoint) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] as [number, number] },
    properties: { which, color: PLACE_POINT_COLOR[which] },
  });
  return {
    type: 'FeatureCollection' as const,
    features: [
      ...(location && pickup
        ? [
            {
              type: 'Feature' as const,
              geometry: {
                type: 'LineString' as const,
                coordinates: [
                  [location.lng, location.lat],
                  [pickup.lng, pickup.lat],
                ] as [number, number][],
              },
              properties: { which: 'link', color: PLACE_POINT_COLOR.pickup },
            },
          ]
        : []),
      ...(location ? [point(location, 'location')] : []),
      ...(pickup ? [point(pickup, 'pickup')] : []),
    ],
  };
}

const toLatLng = (e: { lngLat: { lat: number; lng: number } }): LatLng => ({
  lat: e.lngLat.lat,
  lng: e.lngLat.lng,
});

/**
 * Edición de la ubicación de un lugar (HU-310) sobre <PanterMap>: un clic en el mapa pone el
 * punto elegido (`target`: el lugar o el punto de recogida) y cada marcador se puede arrastrar.
 */
export function PlaceEditLayer(props: {
  enabled: boolean;
  location: LatLng | null;
  pickup: LatLng | null;
  target: PlacePoint;
  onSet: (which: PlacePoint, point: LatLng) => void;
}) {
  const handle = usePanterMap();
  const map = handle?.map;
  const revision = handle?.styleRevision;
  const latest = useLatest(props);

  useEffect(() => {
    if (!map) return;
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: LAYER.link,
      type: 'line',
      source: SRC,
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [2, 1.5] },
    });
    map.addLayer({
      id: LAYER.points,
      type: 'circle',
      source: SRC,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 9,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    });
    const canvas = map.getCanvas();

    const startDrag = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      if (!latest.current.enabled) return;
      const which = e.features?.[0]?.properties?.which as PlacePoint | undefined;
      if (which !== 'location' && which !== 'pickup') return;
      if ('points' in e && e.points.length !== 1) return;
      if (e.originalEvent instanceof MouseEvent && e.originalEvent.button !== 0) return;
      e.preventDefault();
      canvas.style.cursor = 'grabbing';
      const move = (ev: MapMouseEvent | MapTouchEvent) => latest.current.onSet(which, toLatLng(ev));
      const stop = () => {
        map.off('mousemove', move);
        map.off('touchmove', move);
        map.off('mouseup', stop);
        map.off('touchend', stop);
        canvas.style.cursor = latest.current.enabled ? 'crosshair' : '';
      };
      map.on('mousemove', move);
      map.on('touchmove', move);
      map.on('mouseup', stop);
      map.on('touchend', stop);
    };
    const click = (e: MapMouseEvent) => {
      const current = latest.current;
      if (!current.enabled) return;
      const hit = map.getLayer(LAYER.points)
        ? map.queryRenderedFeatures(e.point, { layers: [LAYER.points] })[0]
        : undefined;
      if (hit) return;
      current.onSet(current.target, toLatLng(e));
    };
    const grab = () => {
      if (latest.current.enabled) canvas.style.cursor = 'grab';
    };
    const reset = () => {
      canvas.style.cursor = latest.current.enabled ? 'crosshair' : '';
    };
    map.on('mousedown', LAYER.points, startDrag);
    map.on('touchstart', LAYER.points, startDrag);
    map.on('click', click);
    map.on('mouseenter', LAYER.points, grab);
    map.on('mouseleave', LAYER.points, reset);
    return () => {
      map.off('mousedown', LAYER.points, startDrag);
      map.off('touchstart', LAYER.points, startDrag);
      map.off('click', click);
      map.off('mouseenter', LAYER.points, grab);
      map.off('mouseleave', LAYER.points, reset);
      removeLayers(map, [LAYER.points, LAYER.link], [SRC]);
    };
  }, [map, revision, latest]);

  const { enabled, location, pickup } = props;
  useEffect(() => {
    if (!map) return;
    const source = map.getSource(SRC) as GeoJSONSource | undefined;
    void source?.setData(
      (enabled
        ? placeEditFeatureCollection(location, pickup)
        : { type: 'FeatureCollection', features: [] }) as Parameters<GeoJSONSource['setData']>[0],
    );
    map.getCanvas().style.cursor = enabled ? 'crosshair' : '';
  }, [map, revision, enabled, location, pickup]);

  return null;
}
