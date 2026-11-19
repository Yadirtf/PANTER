// Mapa del pasajero con el estimado (HU-404): toca el mapa o elige un lugar frecuente, cambia el
// origen arrastrando el pin verde y mira la ruta, el precio y su desglose.
import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { MapHomeLayout } from '../../map/components/map-home-layout';
import { PanterMap, type PanterMapHandle } from '../../map/components/panter-map';
import type { LocationStatus } from '../../map/location/location-status';
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

  const destination = state.candidate ?? state.destination?.point ?? null;

  return (
    <MapHomeLayout
      top={top}
      renderMap={(bottomInset) => (
        <PanterMap
          ref={map}
          mode="passenger"
          bottomInset={bottomInset}
          onLocationChange={onLocationChange}
          onPress={(point) => dispatch({ type: 'mapPressed', point })}
        >
          <TripMapLayers
            origin={state.origin.point}
            onOriginDragged={(point) => dispatch({ type: 'originDragged', point })}
            destination={destination}
            pendingConfirmation={state.candidate !== null}
            route={route ?? []}
          />
        </PanterMap>
      )}
      bottom={<TripPanel state={state} dispatch={dispatch} validity={validity} />}
    />
  );
}
