'use client';

import type { Place } from '@panter/contracts';
import { PLACES_LAYER, PLACES_SOURCE } from '@panter/map-style';
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
import { useEffect } from 'react';
import { catalogPlacesFeatureCollection, PLACE_BADGE_LAYER } from '../lib/catalog-places';
import { useLatest, usePanterMap } from './map-context';

/**
 * Lugares del catálogo (GET /places, HU-310) sobre <PanterMap>: llena la fuente `panter-places`
 * del estilo (vacía en panterStyle) después de cada carga de estilo. Ícono de map-style por
 * categoría, insignia de color si no hay ícono y anillo ámbar si no está verificado.
 */
export function CatalogPlacesLayer({
  places,
  onPlaceClick,
}: {
  places: readonly Place[];
  onPlaceClick?: (id: string) => void;
}) {
  const handle = usePanterMap();
  const map = handle?.map;
  const revision = handle?.styleRevision;
  const onClick = useLatest(onPlaceClick);

  useEffect(() => {
    const source = map?.getSource(PLACES_SOURCE) as GeoJSONSource | undefined;
    void source?.setData(
      catalogPlacesFeatureCollection(places) as Parameters<GeoJSONSource['setData']>[0],
    );
  }, [map, revision, places]);

  useEffect(() => {
    if (!map) return;
    const layers = [PLACES_LAYER, PLACE_BADGE_LAYER];
    const click = (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === 'string') onClick.current?.(id);
    };
    const enter = () => {
      if (onClick.current) map.getCanvas().style.cursor = 'pointer';
    };
    const leave = () => {
      map.getCanvas().style.cursor = '';
    };
    for (const layer of layers) {
      map.on('click', layer, click);
      map.on('mouseenter', layer, enter);
      map.on('mouseleave', layer, leave);
    }
    return () => {
      for (const layer of layers) {
        map.off('click', layer, click);
        map.off('mouseenter', layer, enter);
        map.off('mouseleave', layer, leave);
      }
    };
  }, [map, revision, onClick]);

  return null;
}
