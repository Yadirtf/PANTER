'use client';

import type { LatLng } from '@panter/contracts';
import { FONTS, PALETTES, PLACES_LAYER } from '@panter/map-style';
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
import type { DrawDraft, EditableRings, VertexRef } from '../lib/polygon-edit';
import {
  draftFeatureCollection,
  EMPTY_COLLECTION,
  midpointFeatureCollection,
  shapesFeatureCollection,
  vertexFeatureCollection,
  type MapShape,
} from '../lib/polygon-map';

/** Polígono que se está editando: anillos abiertos y vértice seleccionado. */
export interface PolygonEditing {
  id: string;
  rings: EditableRings;
  selected: VertexRef | null;
}

export interface PolygonLayersProps {
  /** Prefijo de las fuentes y capas (varias capas de polígonos en el mismo mapa). */
  id?: string;
  shapes: readonly MapShape[];
  editing: PolygonEditing | null;
  /** Nombre de cada figura como etiqueta sobre el mapa. */
  labels?: boolean;
  onVertexSelect: (ref: VertexRef | null) => void;
  onVertexMove: (ref: VertexRef, to: LatLng) => void;
  onVertexDelete: (ref: VertexRef) => void;
  onMidpointClick: (ring: number, side: number) => void;
  testMode: boolean;
  testPoint: LatLng | null;
  onTestPoint: (point: LatLng) => void;
  /** Dibujo de un polígono nuevo: cada clic agrega un vértice; clic en el primero lo cierra. */
  drawing?: DrawDraft | null;
  onDrawVertex?: (point: LatLng) => void;
  onDrawClose?: () => void;
  /** Clic sobre una figura (fuera de edición, dibujo y prueba). */
  onShapeClick?: (id: string) => void;
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

function ids(prefix: string) {
  return {
    src: {
      shapes: prefix,
      vertices: `${prefix}-vertices`,
      midpoints: `${prefix}-midpoints`,
      draft: `${prefix}-draft`,
      test: `${prefix}-test-point`,
    },
    layer: {
      fill: `${prefix}-fill`,
      line: `${prefix}-line`,
      label: `${prefix}-label`,
      draftLine: `${prefix}-draft-line`,
      draftVertices: `${prefix}-draft-vertices`,
      midpoints: `${prefix}-midpoints`,
      vertices: `${prefix}-vertices`,
      test: `${prefix}-test-point`,
    },
  };
}

/**
 * Polígonos sobre <PanterMap> (geocercas de HU-304, barrios y veredas de HU-309): relleno por
 * color (los huecos quedan vacíos) y, si se pide, el nombre como etiqueta. En edición, los
 * vértices (arrastrar, seleccionar, clic derecho para borrar) y los puntos medios de cada lado
 * (clic para agregar un vértice). En dibujo, cada clic agrega un vértice y un clic en el primero
 * cierra el polígono. En "Probar un punto", un clic marca el punto.
 */
export function PolygonLayers(props: PolygonLayersProps) {
  const handle = usePanterMap();
  const map = handle?.map;
  const revision = handle?.styleRevision;
  const theme = handle?.theme ?? 'light';
  const latest = useLatest(props);
  const prefix = props.id ?? 'panter-polygons';
  const labels = props.labels ?? false;

  // Fuentes, capas y eventos (al crear el mapa y tras cada cambio de tema).
  useEffect(() => {
    if (!map) return;
    const { src: SRC, layer: LAYER } = ids(prefix);
    const palette = PALETTES[theme];
    const before = map.getLayer(PLACES_LAYER) ? PLACES_LAYER : undefined;
    for (const id of Object.values(SRC)) {
      map.addSource(id, { type: 'geojson', data: EMPTY_COLLECTION });
    }
    map.addLayer(
      {
        id: LAYER.fill,
        type: 'fill',
        source: SRC.shapes,
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
        source: SRC.shapes,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'editing'], 3.5, 2],
          'line-opacity': ['case', ['get', 'active'], 1, 0.5],
        },
      },
      before,
    );
    if (labels) {
      map.addLayer(
        {
          id: LAYER.label,
          type: 'symbol',
          source: SRC.shapes,
          layout: {
            'text-field': ['get', 'name'],
            'text-font': [FONTS.bold],
            'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 15],
            'text-max-width': 8,
          },
          paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': palette.labelHalo,
            'text-halo-width': 2,
            'text-opacity': ['case', ['get', 'active'], 1, 0.55],
          },
        },
        before,
      );
    }
    map.addLayer({
      id: LAYER.draftLine,
      type: 'line',
      source: SRC.draft,
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': '#b45309', 'line-width': 3, 'line-dasharray': [2, 1.5] },
    });
    map.addLayer({
      id: LAYER.draftVertices,
      type: 'circle',
      source: SRC.draft,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': ['case', ['get', 'first'], 9, 6],
        'circle-color': ['case', ['get', 'first'], '#f59e0b', '#ffffff'],
        'circle-stroke-color': '#1c1917',
        'circle-stroke-width': 2.5,
      },
    });
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
    const idleCursor = () => (latest.current.testMode || latest.current.drawing ? 'crosshair' : '');

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
        canvas.style.cursor = idleCursor();
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

    const present = (layers: string[]) => layers.filter((id) => map.getLayer(id));

    const click = (e: MapMouseEvent) => {
      const current = latest.current;
      if (current.drawing) {
        const first = map
          .queryRenderedFeatures(e.point, { layers: present([LAYER.draftVertices]) })
          .find((f) => f.properties?.first === true);
        if (first && current.drawing.length >= 3) current.onDrawClose?.();
        else current.onDrawVertex?.(toLatLng(e));
        return;
      }
      const hit = map.queryRenderedFeatures(e.point, {
        layers: present([LAYER.vertices, LAYER.midpoints]),
      })[0];
      if (hit?.layer.id === LAYER.midpoints) {
        const { ring, side } = hit.properties as { ring: number; side: number };
        current.onMidpointClick(ring, side);
        return;
      }
      if (hit) return;
      if (current.testMode) {
        current.onTestPoint(toLatLng(e));
        return;
      }
      if (current.onShapeClick && !current.editing) {
        const shape = map.queryRenderedFeatures(e.point, { layers: present([LAYER.fill]) })[0];
        const id = shape?.properties?.id;
        if (typeof id === 'string') current.onShapeClick(id);
      }
    };

    const pointer = () => {
      canvas.style.cursor = 'pointer';
    };
    const grab = () => {
      canvas.style.cursor = 'grab';
    };
    const reset = () => {
      canvas.style.cursor = idleCursor();
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
  }, [map, revision, theme, prefix, labels, latest]);

  const { shapes, editing, testMode, testPoint, drawing } = props;

  useEffect(() => {
    if (!map) return;
    const { src: SRC } = ids(prefix);
    const shown = shapes.map((s) => (editing?.id === s.id ? { ...s, polygon: editing.rings } : s));
    setSource(map, SRC.shapes, shapesFeatureCollection(shown, editing?.id ?? null));
    setSource(
      map,
      SRC.vertices,
      editing ? vertexFeatureCollection(editing.rings, editing.selected) : EMPTY_COLLECTION,
    );
    setSource(
      map,
      SRC.midpoints,
      editing ? midpointFeatureCollection(editing.rings) : EMPTY_COLLECTION,
    );
  }, [map, revision, theme, prefix, labels, shapes, editing]);

  useEffect(() => {
    if (!map) return;
    const { src: SRC } = ids(prefix);
    setSource(map, SRC.draft, drawing ? draftFeatureCollection(drawing) : EMPTY_COLLECTION);
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
        : EMPTY_COLLECTION,
    );
    map.getCanvas().style.cursor = testMode || drawing ? 'crosshair' : '';
  }, [map, revision, theme, prefix, labels, testMode, testPoint, drawing]);

  return null;
}
