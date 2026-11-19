'use client';

import type { LatLng } from '@panter/contracts';
import { PLACES_LAYER } from '@panter/map-style';
import type {
  GeoJSONSource,
  Map as MaplibreMap,
  MapLayerMouseEvent,
  MapLayerTouchEvent,
  MapMouseEvent,
  MapTouchEvent,
} from 'maplibre-gl';
import { useEffect } from 'react';
import { removeLayers, useLatest, usePanterMap } from '@/features/map/components/map-context';
import {
  geofencesFeatureCollection,
  midpointFeatureCollection,
  vertexFeatureCollection,
  type ShownGeofence,
} from '../lib/geofence-map';
import type { EditableRings, VertexRef } from '../lib/polygon-edit';

const SRC = {
  geofences: 'panter-geofences',
  vertices: 'panter-geofence-vertices',
  midpoints: 'panter-geofence-midpoints',
  test: 'panter-geofence-test-point',
} as const;
const LAYER = {
  fill: 'panter-geofences-fill',
  line: 'panter-geofences-line',
  midpoints: 'panter-geofence-midpoints',
  vertices: 'panter-geofence-vertices',
  test: 'panter-geofence-test-point',
} as const;

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

export interface GeofenceEditing {
  id: string;
  rings: EditableRings;
  selected: VertexRef | null;
}

export interface GeofenceLayersProps {
  geofences: readonly ShownGeofence[];
  editing: GeofenceEditing | null;
  onVertexSelect: (ref: VertexRef | null) => void;
  onVertexMove: (ref: VertexRef, to: LatLng) => void;
  onVertexDelete: (ref: VertexRef) => void;
  onMidpointClick: (ring: number, side: number) => void;
  testMode: boolean;
  testPoint: LatLng | null;
  onTestPoint: (point: LatLng) => void;
}

function setSource(map: MaplibreMap, id: string, data: unknown): void {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  void source?.setData(data as Parameters<GeoJSONSource['setData']>[0]);
}

const toLatLng = (e: { lngLat: { lat: number; lng: number } }): LatLng => ({
  lat: e.lngLat.lat,
  lng: e.lngLat.lng,
});

function vertexRef(e: MapLayerMouseEvent | MapLayerTouchEvent): VertexRef | null {
  const props = e.features?.[0]?.properties;
  if (!props || typeof props.ring !== 'number' || typeof props.vertex !== 'number') return null;
  return { ring: props.ring, vertex: props.vertex };
}

/**
 * Geocercas sobre <PanterMap>: relleno por tipo (los huecos quedan vacíos), y en edición los
 * vértices (arrastrar, seleccionar, clic derecho para borrar) y los puntos medios de cada lado
 * (clic para agregar un vértice). En "Probar un punto", un clic marca el punto.
 */
export function GeofenceLayers(props: GeofenceLayersProps) {
  const handle = usePanterMap();
  const map = handle?.map;
  const revision = handle?.styleRevision;
  const latest = useLatest(props);

  // Fuentes, capas y eventos (al crear el mapa y tras cada cambio de tema).
  useEffect(() => {
    if (!map) return;
    const before = map.getLayer(PLACES_LAYER) ? PLACES_LAYER : undefined;
    for (const id of Object.values(SRC)) map.addSource(id, { type: 'geojson', data: EMPTY });
    map.addLayer(
      {
        id: LAYER.fill,
        type: 'fill',
        source: SRC.geofences,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['get', 'editing'], 0.3, ['get', 'active'], 0.18, 0.06],
        },
      },
      before,
    );
    map.addLayer(
      {
        id: LAYER.line,
        type: 'line',
        source: SRC.geofences,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'editing'], 3.5, 2],
          'line-opacity': ['case', ['get', 'active'], 1, 0.5],
        },
      },
      before,
    );
    map.addLayer({
      id: LAYER.midpoints,
      type: 'circle',
      source: SRC.midpoints,
      paint: {
        'circle-radius': 5,
        'circle-color': '#ffffff',
        'circle-opacity': 0.85,
        'circle-stroke-color': '#44403c',
        'circle-stroke-width': 1.5,
      },
    });
    map.addLayer({
      id: LAYER.vertices,
      type: 'circle',
      source: SRC.vertices,
      paint: {
        'circle-radius': ['case', ['get', 'selected'], 9, 7],
        'circle-color': ['case', ['get', 'selected'], '#f59e0b', '#ffffff'],
        'circle-stroke-color': ['case', ['get', 'hole'], '#7c3aed', '#1c1917'],
        'circle-stroke-width': 2.5,
      },
    });
    map.addLayer({
      id: LAYER.test,
      type: 'circle',
      source: SRC.test,
      paint: {
        'circle-radius': 8,
        'circle-color': '#dc2626',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    });

    const canvas = map.getCanvas();

    const startDrag = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      const ref = vertexRef(e);
      if (!ref) return;
      if ('points' in e && e.points.length !== 1) return;
      if (e.originalEvent instanceof MouseEvent && e.originalEvent.button !== 0) return;
      // Evita que el mapa se desplace mientras se arrastra el vértice.
      e.preventDefault();
      latest.current.onVertexSelect(ref);
      canvas.style.cursor = 'grabbing';
      const move = (ev: MapMouseEvent | MapTouchEvent) =>
        latest.current.onVertexMove(ref, toLatLng(ev));
      const stop = () => {
        map.off('mousemove', move);
        map.off('touchmove', move);
        map.off('mouseup', stop);
        map.off('touchend', stop);
        canvas.style.cursor = '';
      };
      map.on('mousemove', move);
      map.on('touchmove', move);
      map.on('mouseup', stop);
      map.on('touchend', stop);
    };

    const remove = (e: MapLayerMouseEvent) => {
      const ref = vertexRef(e);
      if (!ref) return;
      e.preventDefault();
      latest.current.onVertexDelete(ref);
    };

    const click = (e: MapMouseEvent) => {
      const layers = [LAYER.vertices, LAYER.midpoints].filter((id) => map.getLayer(id));
      const hit = map.queryRenderedFeatures(e.point, { layers })[0];
      if (hit?.layer.id === LAYER.midpoints) {
        const { ring, side } = hit.properties as { ring: number; side: number };
        latest.current.onMidpointClick(ring, side);
        return;
      }
      if (hit) return;
      if (latest.current.testMode) latest.current.onTestPoint(toLatLng(e));
    };

    const pointer = () => {
      canvas.style.cursor = 'pointer';
    };
    const grab = () => {
      canvas.style.cursor = 'grab';
    };
    const reset = () => {
      canvas.style.cursor = latest.current.testMode ? 'crosshair' : '';
    };

    map.on('mousedown', LAYER.vertices, startDrag);
    map.on('touchstart', LAYER.vertices, startDrag);
    map.on('contextmenu', LAYER.vertices, remove);
    map.on('click', click);
    map.on('mouseenter', LAYER.vertices, grab);
    map.on('mouseleave', LAYER.vertices, reset);
    map.on('mouseenter', LAYER.midpoints, pointer);
    map.on('mouseleave', LAYER.midpoints, reset);
    return () => {
      map.off('mousedown', LAYER.vertices, startDrag);
      map.off('touchstart', LAYER.vertices, startDrag);
      map.off('contextmenu', LAYER.vertices, remove);
      map.off('click', click);
      map.off('mouseenter', LAYER.vertices, grab);
      map.off('mouseleave', LAYER.vertices, reset);
      map.off('mouseenter', LAYER.midpoints, pointer);
      map.off('mouseleave', LAYER.midpoints, reset);
      removeLayers(map, Object.values(LAYER).reverse(), Object.values(SRC));
    };
  }, [map, revision, latest]);

  const { geofences, editing, testMode, testPoint } = props;

  useEffect(() => {
    if (!map) return;
    const shown = geofences.map((g) =>
      editing?.id === g.id ? { ...g, polygon: editing.rings } : g,
    );
    setSource(map, SRC.geofences, geofencesFeatureCollection(shown, editing?.id ?? null));
    setSource(
      map,
      SRC.vertices,
      editing ? vertexFeatureCollection(editing.rings, editing.selected) : EMPTY,
    );
    setSource(map, SRC.midpoints, editing ? midpointFeatureCollection(editing.rings) : EMPTY);
  }, [map, revision, geofences, editing]);

  useEffect(() => {
    if (!map) return;
    setSource(
      map,
      SRC.test,
      testMode && testPoint
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [testPoint.lng, testPoint.lat] },
                properties: {},
              },
            ],
          }
        : EMPTY,
    );
    map.getCanvas().style.cursor = testMode ? 'crosshair' : '';
  }, [map, revision, testMode, testPoint]);

  return null;
}
