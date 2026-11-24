// Capas del estimado sobre <PanterMap>: ruta, pin de origen (arrastrable) y pin de destino. Con
// los avisos de HU-307: el punto de la vía donde empieza o termina la ruta (si el pin quedó
// lejos) y la línea recta punteada entre origen y destino (si la ruta es inusual).
import type { LatLng } from '@panter/contracts';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker, Polyline } from 'react-native-maps';
import { fromGoogle, toGoogle } from '../../map/google-map';

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

export function TripMapLayers({
  origin,
  onOriginDragged,
  destination,
  pendingConfirmation,
  route,
  snaps = [],
  straightLine = null,
}: TripMapLayersProps) {
  const line = useMemo(() => route.map(toGoogle), [route]);
  const straight = useMemo(
    () => (straightLine ? straightLine.map(toGoogle) : null),
    [straightLine],
  );

  return (
    <>
      {line.length > 1 ? (
        <>
          {/* Borde blanco para que la ruta se lea en el tema claro y en el oscuro. */}
          <Polyline
            coordinates={line}
            strokeColor="#ffffff"
            strokeWidth={9}
            lineCap="round"
            lineJoin="round"
            zIndex={1}
          />
          <Polyline
            coordinates={line}
            strokeColor={ROUTE_COLOR}
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
            zIndex={2}
          />
        </>
      ) : null}

      {straight ? (
        // Referencia de la línea recta: punteada para no confundirla con la ruta.
        <Polyline
          coordinates={straight}
          strokeColor={WARNING_COLOR}
          strokeWidth={2.5}
          lineDashPattern={[8, 8]}
          zIndex={3}
        />
      ) : null}

      {snaps.map(({ pin, road }, index) => (
        <Polyline
          key={`snap-link-${index}`}
          coordinates={[toGoogle(pin), toGoogle(road)]}
          strokeColor={WARNING_COLOR}
          strokeWidth={2}
          lineDashPattern={[4, 6]}
          zIndex={3}
        />
      ))}
      {snaps.map(({ road }, index) => (
        <Marker
          key={`snap-${index}`}
          identifier={`trip-snap-${index}`}
          coordinate={toGoogle(road)}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View
            style={styles.snap}
            accessibilityLabel="Punto de la vía donde empieza o termina la ruta"
          />
        </Marker>
      ))}

      <Marker
        identifier="trip-origin"
        coordinate={toGoogle(origin)}
        anchor={{ x: 0.5, y: 0.5 }}
        draggable
        tracksViewChanges={false}
        zIndex={10}
        onDragEnd={(event) => onOriginDragged(fromGoogle(event.nativeEvent.coordinate))}
      >
        <View
          style={[styles.pin, { backgroundColor: ORIGIN_COLOR }]}
          accessibilityLabel="Origen. Arrástralo para cambiar el punto de recogida"
        />
      </Marker>

      {destination ? (
        <Marker
          // La clave cambia con el estado: así el marcador se vuelve a dibujar (tracksViewChanges
          // está apagado para no redibujarlo en cada cuadro).
          key={pendingConfirmation ? 'destination-pending' : 'destination'}
          identifier="trip-destination"
          coordinate={toGoogle(destination)}
          anchor={{ x: 0.5, y: 1 }}
          tracksViewChanges={false}
          zIndex={9}
        >
          <View
            style={[styles.flag, pendingConfirmation && styles.pending]}
            accessibilityLabel={pendingConfirmation ? 'Destino por confirmar' : 'Destino'}
          >
            <View style={styles.flagHead} />
            <View style={styles.flagStem} />
          </View>
        </Marker>
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
