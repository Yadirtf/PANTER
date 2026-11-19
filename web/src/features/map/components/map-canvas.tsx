'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { ALL_ICON_IDS, iconImage, type MapIconId, type MapTheme } from '@panter/map-style';
import {
  addProtocol,
  Map as MaplibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type StyleSpecification,
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { publicEnv } from '@/shared/config/env';
import {
  BASEMAP_ERROR_MESSAGE,
  loadBasemap,
  MAP_LOCALE_ES,
  MAP_VIEW,
  panterStyle,
  type Basemap,
} from '../lib/basemap';
import { msUntilNextMinute, resolveMapTheme, type MapThemePreference } from '../lib/theme';
import { PanterMapContext, safely, type PanterMapHandle } from './map-context';
import { MapLoading } from './map-loading';

/**
 * Implementación de <PanterMap> con maplibre-gl. Este módulo SOLO se carga en el navegador
 * (import dinámico sin SSR en panter-map.tsx): aquí están maplibre-gl, pmtiles y su CSS.
 */

let protocolReady = false;

/** Registra el protocolo pmtiles:// y la URL del web worker de MapLibre (una vez por página). */
function setupMaplibre(): void {
  if (protocolReady) return;
  // El bundler copia el worker como recurso estático y da su URL final (con hash).
  setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href);
  addProtocol('pmtiles', new Protocol().tile);
  protocolReady = true;
}

const iconCache = new Map<MapIconId, ReturnType<typeof iconImage>>();

/** Íconos de lugares y vehículos de map-style (RGBA, sin canvas), en cada estilo nuevo. */
function registerIcons(map: MaplibreMap): void {
  for (const id of ALL_ICON_IDS) {
    if (map.hasImage(id)) continue;
    let image = iconCache.get(id);
    if (!image) {
      image = iconImage(id, 2);
      iconCache.set(id, image);
    }
    map.addImage(id, image, { pixelRatio: 2 });
  }
}

/** Tema actual; con 'auto' se recalcula al cambiar cada minuto (hora de Colombia). */
function useMapTheme(preference: MapThemePreference): MapTheme {
  const [theme, setTheme] = useState<MapTheme>(() => resolveMapTheme(preference, new Date()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      setTheme(resolveMapTheme(preference, new Date()));
      if (preference === 'auto') timer = setTimeout(tick, msUntilNextMinute(new Date()));
    };
    tick();
    return () => clearTimeout(timer);
  }, [preference]);
  return theme;
}

export interface MapCanvasProps {
  ariaLabel: string;
  theme: MapThemePreference;
  children?: ReactNode;
}

export function MapCanvas({ ariaLabel, theme: preference, children }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const appliedThemeRef = useRef<MapTheme | null>(null);
  const theme = useMapTheme(preference);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [handle, setHandle] = useState<PanterMapHandle | null>(null);

  // 1. Manifiesto del mapa base (qué .pmtiles está vigente).
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    loadBasemap(publicEnv.NEXT_PUBLIC_API_URL, fetch, controller.signal)
      .then(setBasemap)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [attempt]);

  // 2. El mapa, una vez por manifiesto.
  useEffect(() => {
    const container = containerRef.current;
    if (!basemap || !container) return;
    setupMaplibre();
    const initialTheme = themeRef.current;
    const map = new MaplibreMap({
      container,
      style: panterStyle(basemap.urls, initialTheme) as StyleSpecification,
      center: MAP_VIEW.center,
      zoom: MAP_VIEW.zoom,
      minZoom: MAP_VIEW.minZoom,
      maxZoom: MAP_VIEW.maxZoom,
      maxBounds: MAP_VIEW.maxBounds,
      locale: { ...MAP_LOCALE_ES, 'Map.Title': ariaLabel },
      attributionControl: { compact: true },
      // Ctrl + rueda para acercar: la página se puede desplazar sin mover el mapa.
      cooperativeGestures: true,
      dragRotate: false,
      pitchWithRotate: false,
    });
    appliedThemeRef.current = initialTheme;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();

    let revision = 0;
    map.on('style.load', () => {
      registerIcons(map);
      revision += 1;
      setHandle({ map, styleRevision: revision, theme: appliedThemeRef.current ?? initialTheme });
    });
    map.on('styleimagemissing', (event: { id: string }) => {
      if ((ALL_ICON_IDS as readonly string[]).includes(event.id)) registerIcons(map);
    });
    mapRef.current = map;
    return () => {
      mapRef.current = null;
      setHandle(null);
      safely(() => map.remove());
    };
  }, [basemap, ariaLabel]);

  // 3. Cambio de tema: estilo completo nuevo (las capas propias se vuelven a agregar).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !basemap || appliedThemeRef.current === theme) return;
    appliedThemeRef.current = theme;
    map.setStyle(panterStyle(basemap.urls, theme) as StyleSpecification, { diff: false });
  }, [theme, basemap]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      {failed ? (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-stone-100 p-4 text-center text-sm text-stone-700"
        >
          <p>{BASEMAP_ERROR_MESSAGE}</p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 font-medium hover:bg-stone-50"
          >
            Reintentar
          </button>
        </div>
      ) : handle ? null : (
        <MapLoading />
      )}
      <PanterMapContext.Provider value={handle}>
        {handle ? children : null}
      </PanterMapContext.Provider>
    </div>
  );
}
