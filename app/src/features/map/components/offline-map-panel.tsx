// Panel del conductor para guardar el mapa en el teléfono y usarlo sin señal (HU-303, §6.1).
// Muestra el espacio que hace falta antes de descargar, el progreso, la reanudación y el aviso
// de mapa nuevo publicado.
import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, colors } from '../../../shared/ui/form';
import { useOfflineMap } from '../hooks/use-offline-map';
import { offlineMap } from '../instance';
import { downloadStatusText, formatBytes, progressPercent } from '../offline/format';
import { formatBuildDate, offlineSummary } from '../offline/offline-summary';

export function OfflineMapPanel() {
  const snapshot = useOfflineMap();
  const [open, setOpen] = useState(false);
  if (!snapshot.loaded) return null;

  const { download, current, latest, updateAvailable } = snapshot;
  const summary = offlineSummary(snapshot);
  const requirement = offlineMap.requirement();
  const statusText = downloadStatusText(download);
  const start = () => void offlineMap.start();

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.header}
      >
        <MaterialIcons
          name={current ? 'offline-pin' : 'cloud-download'}
          size={22}
          color={colors.primary}
        />
        <Text style={styles.headerText} numberOfLines={1}>
          {summary}
        </Text>
        <MaterialIcons name={open ? 'expand-more' : 'expand-less'} size={22} color={colors.muted} />
      </Pressable>

      {open ? (
        <View style={styles.body}>
          {current ? (
            <Text style={styles.text}>
              Mapa guardado del {formatBuildDate(current.build)} ({formatBytes(current.size)}). Se
              usa solo cuando no hay señal.
            </Text>
          ) : (
            <Text style={styles.text}>
              Guarda el mapa de Villagarzón, Mocoa y el corredor a Puerto Asís en el teléfono para
              verlo en veredas sin señal.
            </Text>
          )}

          {download.status === 'downloading' ? (
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${progressPercent(download.receivedBytes, download.totalBytes)}%` },
                ]}
              />
            </View>
          ) : null}
          {statusText ? <Text style={styles.status}>{statusText}</Text> : null}

          {download.status === 'downloading' ? (
            <Button
              title="Pausar descarga"
              variant="secondary"
              onPress={() => offlineMap.pause()}
            />
          ) : download.status === 'interrupted' ? (
            <Button title="Reanudar descarga" onPress={start} />
          ) : !latest ? (
            <Text style={styles.status}>Conéctate a internet para descargar el mapa.</Text>
          ) : !current || updateAvailable || download.status !== 'idle' ? (
            <>
              {requirement ? (
                <Text style={styles.status}>
                  {updateAvailable
                    ? `Hay un mapa nuevo del ${formatBuildDate(latest.build)}. `
                    : ''}
                  Tamaño: {formatBytes(latest.size)}. Necesitas{' '}
                  {formatBytes(requirement.requiredBytes)} libres; tienes{' '}
                  {formatBytes(requirement.availableBytes)}.
                </Text>
              ) : null}
              <Button
                title={updateAvailable ? 'Actualizar mapa' : 'Descargar mapa para usar sin señal'}
                onPress={start}
              />
            </>
          ) : null}

          {current && download.status !== 'downloading' ? (
            <Button
              title="Borrar mapa guardado"
              variant="secondary"
              onPress={() =>
                Alert.alert(
                  'Borrar mapa guardado',
                  'Sin él no verás el mapa cuando no haya señal.',
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                      text: 'Borrar',
                      style: 'destructive',
                      onPress: () => void offlineMap.remove(),
                    },
                  ],
                )
              }
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderRadius: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  headerText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  body: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  text: { fontSize: 15, color: colors.text },
  status: { fontSize: 14, color: colors.muted },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: colors.primary },
});
