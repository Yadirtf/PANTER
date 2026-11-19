// Capas del estimado sobre <PanterMap>: ruta, pin de origen (arrastrable) y pin de destino.
import { GeoJSONSource, Layer, ViewAnnotation } from '@maplibre/maplibre-react-native';
import type { LatLng } from '@panter/contracts';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

const ROUTE_COLOR = '#1d4ed8';
const ORIGIN_COLOR = '#15803d';
const DESTINATION_COLOR = '#b42318';

interface TripMapLayersProps {
  origin: LatLng;
  onOriginDragged: (point: LatLng) => void;
  /** Destino confirmado o pin tocado pendiente de confirmar. */
  destination: LatLng | null;
  pendingConfirmation: boolean;
  route: readonly LatLng[];
}

export function TripMapLayers({
  origin,
  onOriginDragged,
  destination,
  pendingConfirmation,
  route,
}: TripMapLayersProps) {
  const line = useMemo<GeoJSON.Feature<GeoJSON.LineString>>(
    () => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: route.map((p) => [p.lng, p.lat]) },
    }),
    [route],
  );

  return (
    <>
      {route.length > 1 ? (
        <GeoJSONSource id="trip-route" data={line}>
          {/* Borde blanco para que la ruta se lea en el tema claro y en el oscuro. */}
          <Layer
            id="trip-route-casing"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': '#ffffff', 'line-width': 9 }}
          />
          <Layer
            id="trip-route-line"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': ROUTE_COLOR, 'line-width': 5 }}
          />
        </GeoJSONSource>
      ) : null}

      <ViewAnnotation
        id="trip-origin"
        lngLat={[origin.lng, origin.lat]}
        draggable
        onDragEnd={(event) => {
          const [lng, lat] = event.nativeEvent.lngLat;
          onOriginDragged({ lat, lng });
        }}
      >
        <View
          style={[styles.pin, { backgroundColor: ORIGIN_COLOR }]}
          accessibilityLabel="Origen. Arrástralo para cambiar el punto de recogida"
        />
      </ViewAnnotation>

      {destination ? (
        <ViewAnnotation
          id="trip-destination"
          lngLat={[destination.lng, destination.lat]}
          anchor="bottom"
        >
          <View
            style={[styles.flag, pendingConfirmation && styles.pending]}
            accessibilityLabel={pendingConfirmation ? 'Destino por confirmar' : 'Destino'}
          >
            <View style={styles.flagHead} />
            <View style={styles.flagStem} />
          </View>
        </ViewAnnotation>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  pin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 4,
    borderColor: '#ffffff',
    elevation: 4,
  },
  flag: { alignItems: 'center' },
  pending: { opacity: 0.7 },
  flagHead: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 4,
    borderColor: '#ffffff',
    backgroundColor: DESTINATION_COLOR,
    elevation: 4,
  },
  flagStem: { width: 4, height: 14, backgroundColor: DESTINATION_COLOR },
});
