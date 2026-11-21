// Capas del estimado sobre <PanterMap>: ruta, pin de origen (arrastrable) y pin de destino. Con
// los avisos de HU-307: el punto de la vía donde empieza o termina la ruta (si el pin quedó
// lejos) y la línea recta punteada entre origen y destino (si la ruta es inusual).
import { GeoJSONSource, Layer, ViewAnnotation } from '@maplibre/maplibre-react-native';
import type { LatLng } from '@panter/contracts';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

const ROUTE_COLOR = '#1d4ed8';
const ORIGIN_COLOR = '#15803d';
const DESTINATION_COLOR = '#b42318';
const WARNING_COLOR = '#b45309';

export interface SnapMarker {
  /** Pin pedido por el pasajero. */
  pin: LatLng;
  /** Punto de la vía donde empieza o termina la ruta. */
  road: LatLng;
}

interface TripMapLayersProps {
  origin: LatLng;
  onOriginDragged: (point: LatLng) => void;
  /** Destino confirmado o pin tocado pendiente de confirmar. */
  destination: LatLng | null;
  pendingConfirmation: boolean;
  route: readonly LatLng[];
  /** Ajustes a la vía que superan el umbral (HU-307). */
  snaps?: readonly SnapMarker[];
  /** Línea recta origen → destino de una ruta inusual (HU-307). */
  straightLine?: readonly [LatLng, LatLng] | null;
}

function lineFeature(points: readonly LatLng[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) },
  };
}

export function TripMapLayers({
  origin,
  onOriginDragged,
  destination,
  pendingConfirmation,
  route,
  snaps = [],
  straightLine = null,
}: TripMapLayersProps) {
  const line = useMemo(() => lineFeature(route), [route]);
  const straight = useMemo(() => (straightLine ? lineFeature(straightLine) : null), [straightLine]);
  const snapLinks = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(
    () => ({
      type: 'FeatureCollection',
      features: snaps.map(({ pin, road }) => lineFeature([pin, road])),
    }),
    [snaps],
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

      {straight ? (
        // Referencia de la línea recta: punteada para no confundirla con la ruta.
        <GeoJSONSource id="trip-straight-line" data={straight}>
          <Layer
            id="trip-straight-line"
            type="line"
            paint={{
              'line-color': WARNING_COLOR,
              'line-width': 2.5,
              'line-dasharray': [2, 2],
              'line-opacity': 0.9,
            }}
          />
        </GeoJSONSource>
      ) : null}

      {snaps.length > 0 ? (
        <GeoJSONSource id="trip-snap-links" data={snapLinks}>
          <Layer
            id="trip-snap-links"
            type="line"
            paint={{ 'line-color': WARNING_COLOR, 'line-width': 2, 'line-dasharray': [1, 1.5] }}
          />
        </GeoJSONSource>
      ) : null}
      {snaps.map(({ road }, index) => (
        <ViewAnnotation
          key={`snap-${index}`}
          id={`trip-snap-${index}`}
          lngLat={[road.lng, road.lat]}
        >
          <View
            style={styles.snap}
            accessibilityLabel="Punto de la vía donde empieza o termina la ruta"
          />
        </ViewAnnotation>
      ))}

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
  snap: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: WARNING_COLOR,
    backgroundColor: '#ffffff',
    elevation: 3,
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
