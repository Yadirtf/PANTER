// Mapa del pasajero con el estimado (HU-404): elige el destino por lugar, barrio o vereda, o
// tocando el mapa o un establecimiento del mapa base (HU-311); cambia el origen arrastrando el pin
// verde y mira la ruta, el precio, su desglose y los avisos de calidad de la ruta (HU-307).
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { AreaOutlineLayer } from '../../catalog/components/area-outline-layer';
import { catalogRepository } from '../../catalog/instance';
import { areaFramePoints, resolveCatalogPoi } from '../../catalog/selection';
import { MapHomeLayout } from '../../map/components/map-home-layout';
import { PanterMap, type PanterMapHandle } from '../../map/components/panter-map';
import type { LocationStatus } from '../../map/location/location-status';
import { plannerRouteNotices } from '../estimate/planner';
import { useTripPlanner } from '../use-trip-planner';
import { TripMapLayers } from './trip-map-layers';
import { TripPanel } from './trip-panel';

export function TripPlanner({ top }: { top: ReactNode }) {
  const { state, dispatch, validity } = useTripPlanner();
  const map = useRef<PanterMapHandle>(null);

  const onLocationChange = useCallback(
    (status: LocationStatus) => {
      if (status.kind === 'ok') dispatch({ type: 'userLocated', point: status.position });
    },
    [dispatch],
  );

  // Encuadra la ruta cada vez que llega una cotización nueva.
  const route =
    state.quote.status === 'ready' || state.quote.status === 'expired' ? state.quote.route : null;
  useEffect(() => {
    if (route && route.length > 1) map.current?.fitPoints(route, 80);
  }, [route]);

  // Encuadra el croquis del barrio o vereda elegido.
  const area = state.areaPick?.area ?? null;
  useEffect(() => {
    if (area) map.current?.fitPoints(areaFramePoints(area), 60);
  }, [area]);

  const destination = state.candidate?.point ?? state.destination?.point ?? null;

  // Avisos de HU-307 sobre el mapa: punto de la vía y línea recta de referencia.
  const notices = useMemo(() => plannerRouteNotices(state), [state]);
  const snaps = useMemo(
    () =>
      notices.snaps.flatMap((notice) =>
        notice.roadPoint
          ? [
              {
                pin: notice.end === 'origin' ? state.origin.point : state.destination!.point,
                road: notice.roadPoint,
              },
            ]
          : [],
      ),
    [notices],
  );

  return (
    <MapHomeLayout
      top={top}
      renderMap={(bottomInset) => (
        <PanterMap
          ref={map}
          mode="passenger"
          bottomInset={bottomInset}
          onLocationChange={onLocationChange}
          tapPois
          onPress={(point, poi) => {
            if (!poi?.placeSlug) {
              dispatch({ type: 'mapPressed', point, poi });
              return;
            }
            // Punto clave de PANTER: se usa el lugar del catálogo (ubicación real).
            catalogRepository.knownPlaces().then(
              (places) =>
                dispatch({ type: 'mapPressed', point, poi: resolveCatalogPoi(poi, places) }),
              () => dispatch({ type: 'mapPressed', point, poi }),
            );
          }}
        >
          {state.areaPick ? (
            <AreaOutlineLayer area={state.areaPick.area} warning={state.areaPick.outside} />
          ) : null}
          <TripMapLayers
            origin={state.origin.point}
            onOriginDragged={(point) => dispatch({ type: 'originDragged', point })}
            destination={destination}
            pendingConfirmation={state.candidate !== null}
            route={route ?? []}
            snaps={snaps}
            straightLine={notices.unusual?.straightLine ?? null}
          />
        </PanterMap>
      )}
      bottom={<TripPanel state={state} dispatch={dispatch} validity={validity} />}
    />
  );
}
