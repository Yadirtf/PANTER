// Captura de un documento con expo-camera (HU-203).
//
// Se usa expo-camera y no expo-image-picker en modo cámara porque el selector abre la cámara del
// sistema, sobre la que no se puede dibujar nada: con CameraView se muestra la guía de encuadre
// (recuadro con la proporción de la cédula o de la hoja del SOAT) y la indicación de cada
// documento, que es lo que evita fotos rechazadas por cortadas o ilegibles.
import { DOCUMENT_LABELS, type DocumentType } from '@panter/contracts';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage } from '../../../shared/api/error-messages';
import { toApiError } from '../../../shared/api/errors';
import { Button, colors, ErrorMessage } from '../../../shared/ui/form';
import { framingGuideFor } from '../documents/document-states';
import { uploadQueue } from '../instance';
import { compressDocumentPhoto } from '../native/compress-image';

interface DocumentCameraProps {
  type: DocumentType | null;
  onClose: () => void;
}

export function DocumentCamera({ type, onClose }: DocumentCameraProps) {
  return (
    <Modal visible={type !== null} animationType="slide" onRequestClose={onClose}>
      {type ? <CameraContent type={type} onClose={onClose} /> : null}
    </Modal>
  );
}

function CameraContent({ type, onClose }: { type: DocumentType; onClose: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guide = framingGuideFor(type);

  async function capture() {
    if (!camera.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const picture = await camera.current.takePictureAsync({ quality: 1, shutterSound: false });
      const photo = await compressDocumentPhoto(picture);
      await uploadQueue.enqueue({ type, sourceUri: photo.uri, contentType: 'image/jpeg' });
      onClose();
    } catch (err) {
      setError(errorMessage(toApiError(err)));
      setBusy(false);
    }
  }

  if (!permission) return <SafeAreaView style={styles.dark} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permission}>
        <Text style={styles.permissionTitle}>Necesitamos la cámara</Text>
        <Text style={styles.permissionText}>
          PANTER usa la cámara solo para fotografiar tus documentos de conductor. Las fotos se
          envían de forma segura para que un administrador las revise.
        </Text>
        {permission.canAskAgain ? (
          <Button title="Permitir la cámara" onPress={() => void requestPermission()} />
        ) : (
          <Button title="Abrir ajustes del teléfono" onPress={() => void Linking.openSettings()} />
        )}
        <Button title="Cancelar" variant="secondary" onPress={onClose} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.dark}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        onCameraReady={() => setReady(true)}
      />
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.title}>{DOCUMENT_LABELS[type]}</Text>
        <View style={styles.frameArea} pointerEvents="none">
          <View
            style={[styles.frame, { aspectRatio: guide.aspectRatio }]}
            accessibilityLabel="Guía de encuadre"
          />
        </View>
        <Text style={styles.hint}>{guide.hint}</Text>
        <ErrorMessage>{error}</ErrorMessage>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancelar"
            onPress={onClose}
            style={styles.textButton}
          >
            <Text style={styles.textButtonLabel}>Cancelar</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tomar foto"
            accessibilityState={{ disabled: !ready || busy, busy }}
            disabled={!ready || busy}
            onPress={() => void capture()}
            style={[styles.shutter, (!ready || busy) && styles.shutterDisabled]}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <View style={styles.textButton} />
        </View>
        {busy ? <Text style={styles.hint}>Preparando la foto…</Text> : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  dark: { flex: 1, backgroundColor: '#000000' },
  overlay: { flex: 1, padding: 20, gap: 12 },
  title: { color: '#ffffff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  frameArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: '100%',
    maxHeight: '100%',
    borderWidth: 3,
    borderColor: '#ffffff',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  hint: { color: '#ffffff', fontSize: 16, textAlign: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  textButton: { width: 90, minHeight: 48, justifyContent: 'center' },
  textButtonLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDisabled: { opacity: 0.4 },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#ffffff' },
  permission: {
    flex: 1,
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: colors.background,
  },
  permissionTitle: { fontSize: 22, fontWeight: '700', color: colors.text },
  permissionText: { fontSize: 16, color: colors.muted },
});
