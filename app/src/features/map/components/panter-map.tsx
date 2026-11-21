// <PanterMap> (HU-303): mapa base propio con @maplibre/maplibre-react-native.
// - Estilo de @panter/map-style (buildStyle) sobre el .pmtiles de basemap.json o, en modo
//   conductor y sin señal, sobre la copia descargada.
// - Tema claro/oscuro según la hora de Colombia (cambia solo a las 20:00 y a las 05:00).
// - Íconos de lugares y vehículos registrados con <Images>.
// - Cámara limitada al área de servicio y centrada en Villagarzón.
// - Punto de ubicación del usuario, botón "centrar en mi ubicación" y avisos de permiso, GPS
//   apagado y fuera del área, sin bloquear el mapa.
// - Con `tapPois`, cada toque consulta las capas de establecimientos y lugares del estilo
//   (queryRenderedFeatures) y entrega el que tenga nombre (HU-311).
// Los hijos (fuentes, capas, anotaciones) se dibujan encima del mapa base.
import { MaterialIcons } from '@expo/vector-icons';
import {
  Camera,
  type CameraRef,
  Images,
  Map as MapView,
  type MapRef,
  NativeUserLocation,
} from '@maplibre/maplibre-react-native';
import { type LatLng, PLACES, SERVICE_AREA } from '@panter/contracts';
import { buildStyle } from '@panter/map-style';
import {
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, colors } from '../../../shared/ui/form';
import { useMapSource } from '../hooks/use-map-source';
import { useMapTheme } from '../hooks/use-map-theme';
import { useUserLocation } from '../hooks/use-user-location';
import { canCenterOnUser, type LocationStatus, locationNotice } from '../location/location-status';
import { type MapPoi, POI_TAP_TOLERANCE_PX, poiFromFeatures, TAPPABLE_POI_LAYERS } from '../poi';
import { mapImages } from './map-images';

/** [oeste, sur, este, norte], el formato de `maxBounds` de maplibre-react-native. */
const MAX_BOUNDS: [number, number, number, number] = [
  SERVICE_AREA.west,
  SERVICE_AREA.south,
  SERVICE_AREA.east,
  SERVICE_AREA.north,
];
const INITIAL_CENTER: [number, number] = [
  PLACES.VILLAGARZON_CENTER.lng,
  PLACES.VILLAGARZON_CENTER.lat,
];
const INITIAL_ZOOM = 13;
const USER_ZOOM = 16;

export interface PanterMapHandle {
  flyTo(point: LatLng, zoom?: number): void;
  /** Encuadra los puntos (p. ej. una ruta) con un margen en píxeles. */
  fitPoints(points: readonly LatLng[], padding?: number): void;
}

export interface PanterMapProps {
  mode: 'passenger' | 'driver';
  children?: ReactNode;
  /**
   * Toque en el mapa (no en una anotación). Con `tapPois`, `poi` es el establecimiento o lugar
   * con nombre que se tocó, o `null`.
   */
  onPress?: (point: LatLng, poi: MapPoi | null) => void;
  /** Consultar los POI del mapa base y los lugares de PANTER en cada toque. */
  tapPois?: boolean;
  /** Cada cambio del estado de ubicación del usuario. */
  onLocationChange?: (status: LocationStatus) => void;
  /** Espacio inferior ocupado por paneles: el botón de centrar y los avisos quedan encima. */
  bottomInset?: number;
  ref?: Ref<PanterMapHandle>;
}

export function PanterMap({
  mode,
  children,
  onPress,
  tapPois = false,
  onLocationChange,
  bottomInset = 0,
  ref,
}: PanterMapProps) {
  const theme = useMapTheme();
  const { source, online, reload } = useMapSource(mode);
  const location = useUserLocation();
  const camera = useRef<CameraRef>(null);
  const mapView = useRef<MapRef>(null);
  const [failed, setFailed] = useState(false);

  const urls = source && source.kind !== 'unavailable' ? source.urls : null;
  // Se recalcula solo si cambian las URLs o el tema: cada estilo nuevo recarga el mapa.
  const urlsKey = urls ? `${urls.tilesUrl}|${urls.glyphsUrl}|${urls.spriteUrl}` : null;
  const style = useMemo(
    () => (urls ? buildStyle({ ...urls, theme }) : null),
    // `urls` cambia de identidad sin cambiar de valor: se compara por `urlsKey`.
    [urlsKey, theme],
  );
  // Una fuente nueva (otra red, otra copia) merece un intento nuevo.
  useEffect(() => setFailed(false), [style]);

  useEffect(() => onLocationChange?.(location.status), [location.status, onLocationChange]);

  useImperativeHandle(
    ref,
    () => ({
      flyTo(point, zoom = USER_ZOOM) {
        camera.current?.flyTo({ center: [point.lng, point.lat], zoom, duration: 800 });
      },
      fitPoints(points, padding = 64) {
        if (points.length === 0) return;
        const lngs = points.map((p) => p.lng);
        const lats = points.map((p) => p.lat);
        camera.current?.fitBounds(
          [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
          {
            padding: { top: padding, right: padding, bottom: padding, left: padding },
            duration: 800,
          },
        );
      },
    }),
    [],
  );

  const notice = locationNotice(location.status);
  const status = location.status;
  const showUser = status.kind === 'ok' || status.kind === 'outside' || status.kind === 'locating';

  return (
    <View style={styles.flex}>
      {style ? (
        <MapView
          ref={mapView}
          style={styles.flex}
          mapStyle={style}
          logo={false}
          compass={false}
          attributionPosition={{ bottom: bottomInset + 8, left: 8 }}
          onPress={(event) => {
            const [lng, lat] = event.nativeEvent.lngLat;
            const point = { lat, lng };
            if (!onPress) return;
            if (!tapPois || !mapView.current) {
              onPress(point, null);
              return;
            }
            const [x, y] = event.nativeEvent.point;
            const t = POI_TAP_TOLERANCE_PX;
            mapView.current
              .queryRenderedFeatures(
                [
                  [x - t, y - t],
                  [x + t, y + t],
                ],
                { layers: [...TAPPABLE_POI_LAYERS] },
              )
              .then(
                (features) => onPress(point, poiFromFeatures(features, point)),
                // Si la consulta falla (estilo cargando), el toque vale como un punto cualquiera.
                () => onPress(point, null),
              );
          }}
          onDidFailLoadingMap={() => setFailed(true)}
          onDidFinishLoadingMap={() => setFailed(false)}
        >
          <Camera
            ref={camera}
            initialViewState={{ center: INITIAL_CENTER, zoom: INITIAL_ZOOM }}
            maxBounds={MAX_BOUNDS}
            minZoom={8}
            maxZoom={18}
          />
          <Images images={mapImages()} />
          {showUser ? <NativeUserLocation /> : null}
          {children}
        </MapView>
      ) : (
        <MapPlaceholder
          loading={source === null}
          message={
            source?.kind === 'unavailable'
              ? source.reason === 'offline'
                ? 'Sin conexión no podemos cargar el mapa. Se mostrará cuando vuelva la señal.'
                : 'No pudimos cargar el mapa. Intenta de nuevo.'
              : null
          }
          onRetry={reload}
        />
      )}

      <View pointerEvents="box-none" style={[styles.bottom, { bottom: bottomInset + 16 }]}>
        {failed && style ? (
          <Notice
            title="El mapa no cargó completo"
            body={
              online
                ? 'Revisa tu conexión e intenta de nuevo.'
                : mode === 'driver'
                  ? 'Estás sin señal. Descarga el mapa para usarlo sin conexión.'
                  : 'Estás sin señal. El mapa se completará cuando vuelva la conexión.'
            }
            action={{ label: 'Reintentar', onPress: reload }}
          />
        ) : null}
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
                camera.current?.flyTo({
                  center: [status.position.lng, status.position.lat],
                  zoom: USER_ZOOM,
                  duration: 800,
                });
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

function MapPlaceholder({
  loading,
  message,
  onRetry,
}: {
  loading: boolean;
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <View style={[styles.flex, styles.placeholder]}>
      {loading ? <ActivityIndicator size="large" color={colors.primary} /> : null}
      {message ? (
        <>
          <Text style={styles.noticeBody}>{message}</Text>
          <Button title="Reintentar" variant="secondary" onPress={onRetry} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: '#e8efe9',
  },
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
