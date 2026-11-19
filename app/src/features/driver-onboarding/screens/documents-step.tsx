// Paso 2 · Documentos (HU-203): los 5 documentos con su estado, captura y progreso general.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { DocumentType } from '@panter/contracts';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../shared/ui/form';
import {
  canCapture,
  type DocumentRow,
  type DocumentsProgress,
  documentStateLabel,
  type DocumentUiState,
} from '../documents/document-states';
import { uploadQueue } from '../instance';
import { DocumentCamera } from './document-camera';

interface DocumentsStepProps {
  rows: readonly DocumentRow[];
  progress: DocumentsProgress;
  online: boolean;
  /** Si se indica, solo estos documentos se pueden volver a tomar (corrección tras rechazo). */
  onlyTypes?: readonly DocumentType[];
}

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function stateVisual(state: DocumentUiState): { icon: IconName; color: string } {
  switch (state.kind) {
    case 'missing':
      return { icon: 'camera-outline', color: colors.muted };
    case 'uploading':
      return state.waiting === 'offline'
        ? { icon: 'wifi-off', color: '#b54708' }
        : { icon: 'cloud-upload-outline', color: colors.primary };
    case 'uploadFailed':
      return { icon: 'alert-circle', color: colors.error };
    case 'inReview':
      return { icon: 'clock-outline', color: '#1d4ed8' };
    case 'approved':
      return { icon: 'check-circle', color: '#027a48' };
    case 'rejected':
      return { icon: 'alert-circle', color: colors.error };
  }
}

function actionLabel(state: DocumentUiState): string {
  if (state.kind === 'missing') return 'Tomar foto';
  if (state.kind === 'uploading') return 'Repetir foto';
  return 'Tomar de nuevo';
}

export function DocumentsStep({ rows, progress, online, onlyTypes }: DocumentsStepProps) {
  const [capturing, setCapturing] = useState<DocumentType | null>(null);

  return (
    <View style={styles.container}>
      <Text style={styles.step}>Paso 2 de 2 · Tus documentos</Text>
      <View
        style={styles.progressBox}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={progress.label}
        accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}
      >
        <Text style={styles.progressLabel}>{progress.label}</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${(progress.done / progress.total) * 100}%` }]} />
        </View>
      </View>
      {!online ? (
        <Text style={styles.offline}>
          Estás sin señal. Puedes seguir tomando las fotos: se guardan en el teléfono y se suben
          solas cuando vuelva la conexión.
        </Text>
      ) : null}

      {rows.map((row) => {
        const visual = stateVisual(row.state);
        const allowed =
          canCapture(row.state) && (onlyTypes === undefined || onlyTypes.includes(row.type));
        return (
          <View key={row.type} style={styles.row}>
            <MaterialCommunityIcons name={visual.icon} size={28} color={visual.color} />
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={[styles.rowState, { color: visual.color }]}>
                {documentStateLabel(row.state)}
              </Text>
              {row.state.kind === 'rejected' ? (
                <Text style={styles.reason}>Motivo: {row.state.reason}</Text>
              ) : null}
              {row.state.kind === 'uploadFailed' ? (
                <Text style={styles.reason}>{row.state.message}</Text>
              ) : null}
              {row.state.kind === 'uploading' && row.state.waiting === null ? (
                <View style={styles.track}>
                  <View
                    style={[styles.fill, { width: `${Math.round(row.state.progress * 100)}%` }]}
                  />
                </View>
              ) : null}
              {row.state.kind === 'uploading' && row.state.waiting === 'retry' && online ? (
                <Text
                  accessibilityRole="button"
                  style={styles.link}
                  onPress={() => uploadQueue.retryNow(row.type)}
                >
                  Reintentar ahora
                </Text>
              ) : null}
            </View>
            {allowed ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${actionLabel(row.state)}: ${row.label}`}
                onPress={() => setCapturing(row.type)}
                style={styles.capture}
              >
                <Text style={styles.captureText}>{actionLabel(row.state)}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      <DocumentCamera type={capturing} onClose={() => setCapturing(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, alignSelf: 'stretch' },
  step: { fontSize: 14, fontWeight: '600', color: colors.muted },
  progressBox: { gap: 6 },
  progressLabel: { fontSize: 18, fontWeight: '700', color: colors.text },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginTop: 4,
  },
  fill: { height: '100%', backgroundColor: colors.primary },
  offline: {
    backgroundColor: '#fffaeb',
    color: '#93370d',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowState: { fontSize: 14 },
  reason: { fontSize: 14, color: colors.error },
  link: { fontSize: 14, color: colors.primary, fontWeight: '600', paddingVertical: 4 },
  capture: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary,
    justifyContent: 'center',
  },
  captureText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
});
