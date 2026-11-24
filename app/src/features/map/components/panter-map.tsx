// <PanterMap> (HU-303): mapa de Google con react-native-maps (PROVIDER_GOOGLE).
// Se usa Google Maps porque las rutas salen de Google Routes API y sus condiciones exigen
// mostrarlas sobre un mapa de Google.
// - Tema claro/oscuro según la hora de Colombia (cambia solo a las 20:00 y a las 05:00).
// - Puntos clave de PANTER (KEY_PLACES) con su ícono propio.
// - Cámara limitada al área de servicio y centrada en Villagarzón.
// - Punto de ubicación del usuario, botón "centrar en mi ubicación" y avisos de permiso, GPS
//   apagado y fuera del área, sin bloquear el mapa.
// - Con `tapPois`, tocar un lugar de Google o un punto clave lo entrega como destino (HU-311).
// - `bottomInset` también es el margen del mapa: el logo de Google (obligatorio) queda visible
//   encima del panel inferior.
// Los hijos (rutas, marcadores, polígonos de react-native-maps) se dibujan encima del mapa.
import { MaterialIcons } from '@expo/vector-icons';
import type { LatLng } from '@panter/contracts';
import { ICON_SIZE, iconPngDataUrl, KEY_PLACES } from '@panter/map-style';
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Button, colors } from '../../../shared/ui/form';
import {
  CAMERA_DURATION_MS,
  edgePadding,
  fromGoogle,
  INITIAL_CAMERA,
  MAP_BOUNDARIES,
  mapStyleFor,
  MAX_ZOOM,
  MIN_ZOOM,
  toGoogle,
  USER_ZOOM,
} from '../google-map';
import { useMapTheme } from '../hooks/use-map-theme';
import { useUserLocation } from '../hooks/use-user-location';
import { canCenterOnUser, type LocationStatus, locationNotice } from '../location/location-status';
import { type MapPoi, poiFromGoogle, poiFromKeyPlace } from '../poi';

/** Densidad de los íconos de los puntos clave (la de la mayoría de teléfonos Android). */
const ICON_PIXEL_RATIO = 3;

export interface PanterMapHandle {
  flyTo(point: LatLng, zoom?: number): void;
  /** Encuadra los puntos (p. ej. una ruta) con un margen en píxeles. */
  fitPoints(points: readonly LatLng[], padding?: number): void;
}

export interface PanterMapProps {
  mode: 'passenger' | 'driver';
  children?: ReactNode;
  /**
   * Toque en el mapa. Con `tapPois`, `poi` es el lugar de Google o el punto clave de PANTER que
   * se tocó, o `null` si se tocó un punto cualquiera.
   */
  onPress?: (point: LatLng, poi: MapPoi | null) => void;
  /** Entregar como destino los lugares de Google y los puntos clave tocados. */
  tapPois?: boolean;
  /** Cada cambio del estado de ubicación del usuario. */
  onLocationChange?: (status: LocationStatus) => void;
  /** Espacio inferior ocupado por paneles: el botón de centrar y los avisos quedan encima. */
  bottomInset?: number;
  ref?: Ref<PanterMapHandle>;
}

export function PanterMap({
  children,
  onPress,
  tapPois = false,
  onLocationChange,
  bottomInset = 0,
  ref,
}: PanterMapProps) {
  const theme = useMapTheme();
  const location = useUserLocation();
  const map = useRef<MapView>(null);
  const customMapStyle = useMemo(() => mapStyleFor(theme), [theme]);
  const keyPlaceIcons = useMemo(
    () =>
      Object.fromEntries(
        KEY_PLACES.map((place) => [place.id, iconPngDataUrl(place.icon, ICON_PIXEL_RATIO)]),
      ),
    [],
  );

  useEffect(() => onLocationChange?.(location.status), [location.status, onLocationChange]);

  function flyTo(point: LatLng, zoom = USER_ZOOM) {
    map.current?.animateCamera({ center: toGoogle(point), zoom }, { duration: CAMERA_DURATION_MS });
  }

  useImperativeHandle(
    ref,
    () => ({
      flyTo,
      fitPoints(points, padding = 64) {
        if (points.length === 0) return;
        map.current?.fitToCoordinates(points.map(toGoogle), {
          edgePadding: edgePadding(padding),
          animated: true,
        });
      },
    }),
    [],
  );

  const notice = locationNotice(location.status);
  const status = location.status;
  const showUser = status.kind === 'ok' || status.kind === 'outside' || status.kind === 'locating';

  return (
    <View style={styles.flex}>
      <MapView
        ref={map}
        provider={PROVIDER_GOOGLE}
        style={styles.flex}
        initialCamera={INITIAL_CAMERA}
        customMapStyle={customMapStyle}
        minZoomLevel={MIN_ZOOM}
        maxZoomLevel={MAX_ZOOM}
        mapPadding={{ top: 0, right: 0, bottom: bottomInset, left: 0 }}
        showsUserLocation={showUser}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        onMapReady={() =>
          map.current?.setMapBoundaries(MAP_BOUNDARIES.northEast, MAP_BOUNDARIES.southWest)
        }
        onPress={(event) => {
          // Un toque sobre un marcador también llega aquí con action "marker-press": se ignora.
          if (event.nativeEvent.action === 'marker-press') return;
          onPress?.(fromGoogle(event.nativeEvent.coordinate), null);
        }}
        onPoiClick={(event) => {
          const point = fromGoogle(event.nativeEvent.coordinate);
          onPress?.(point, tapPois ? poiFromGoogle(event.nativeEvent) : null);
        }}
      >
        {KEY_PLACES.map((place) => (
          <Marker
            key={place.id}
            identifier={`place-${place.id}`}
            coordinate={toGoogle(place.position)}
            title={place.name}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            onPress={() => onPress?.(place.position, tapPois ? poiFromKeyPlace(place) : null)}
          >
            <Image
              source={{ uri: keyPlaceIcons[place.id] }}
              style={styles.placeIcon}
              accessibilityLabel={place.name}
            />
          </Marker>
        ))}
        {children}
      </MapView>

      <View pointerEvents="box-none" style={[styles.bottom, { bottom: bottomInset + 16 }]}>
        {notice ? (
          <Notice
            title={notice.title}
            body={notice.body}
            action={
              notice.action
                ? { label: notice.action.label, onPress: () => location.act(notice.action!.kind) }
                : null
            }
          />
        ) : null}
        <View style={styles.controls}>
          <CenterButton
            enabled={canCenterOnUser(status)}
            onPress={() => {
              if (canCenterOnUser(status)) {
                flyTo(status.position);
              } else if (notice?.action) {
                location.act(notice.action.kind);
              }
            }}
          />
        </View>
      </View>
    </View>
  );
}

function CenterButton({ enabled, onPress }: { enabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Centrar en mi ubicación"
      accessibilityState={{ disabled: !enabled }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.center,
        !enabled && styles.centerDisabled,
        pressed && styles.pressed,
      ]}
    >
      <MaterialIcons
        name={enabled ? 'my-location' : 'location-disabled'}
        size={26}
        color={enabled ? colors.primary : colors.muted}
      />
    </Pressable>
  );
}

function Notice({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: { label: string; onPress: () => void } | null;
}) {
  return (
    <View style={styles.notice} accessibilityRole="alert">
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.noticeBody}>{body}</Text>
      {action ? <Button title={action.label} variant="secondary" onPress={action.onPress} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  placeIcon: { width: ICON_SIZE, height: ICON_SIZE },
  bottom: { position: 'absolute', left: 12, right: 12, gap: 8 },
  controls: { flexDirection: 'row', justifyContent: 'flex-end' },
  center: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  centerDisabled: { opacity: 0.8 },
  pressed: { opacity: 0.7 },
  notice: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  noticeTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  noticeBody: { fontSize: 15, color: colors.muted, textAlign: 'left' },
});
