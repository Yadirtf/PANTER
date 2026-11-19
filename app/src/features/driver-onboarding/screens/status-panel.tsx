// Estado de la solicitud de conductor (HU-205): en revisión, rechazada, aprobada o suspendida.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, colors, ErrorMessage } from '../../../shared/ui/form';
import { useSession } from '../../auth/session/session-context';
import { activateDriverMode } from '../status/activate-driver-mode';
import type { OnboardingView, StatusNotice } from '../status/onboarding-status';

const TONES = {
  success: { background: '#ecfdf3', color: '#027a48', icon: 'check-circle' },
  warning: { background: '#fffaeb', color: '#93370d', icon: 'alert-circle' },
  info: { background: '#eff8ff', color: '#175cd3', icon: 'clock-outline' },
} as const;

export function NoticeBanner({
  notice,
  onDismiss,
}: {
  notice: StatusNotice;
  onDismiss: () => void;
}) {
  const tone = TONES[notice.tone];
  return (
    <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: tone.background }]}>
      <MaterialCommunityIcons name={tone.icon} size={22} color={tone.color} />
      <Text style={[styles.noticeText, { color: tone.color }]}>{notice.message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cerrar aviso"
        onPress={onDismiss}
        hitSlop={12}
      >
        <MaterialCommunityIcons name="close" size={20} color={tone.color} />
      </Pressable>
    </View>
  );
}

type PanelView = Exclude<OnboardingView, { kind: 'notApplied' }>;

export function StatusPanel({
  view,
  onCorrectVehicle,
}: {
  view: PanelView;
  onCorrectVehicle: () => void;
}) {
  switch (view.kind) {
    case 'pending':
      return (
        <Card tone={view.missing.length === 0 ? 'info' : 'warning'} title={view.title}>
          <Text style={styles.body}>{view.message}</Text>
        </Card>
      );
    case 'rejected':
      return (
        <Card tone="warning" title="Tu solicitud fue rechazada">
          <Text style={styles.label}>Motivo</Text>
          <Text style={styles.body}>{view.reason}</Text>
          <Text style={styles.label}>Qué corregir</Text>
          <Text style={styles.body}>{view.message}</Text>
          <Button
            title="Corregir datos del vehículo"
            variant="secondary"
            onPress={onCorrectVehicle}
          />
        </Card>
      );
    case 'approved':
      return <ApprovedPanel title={view.title} message={view.message} />;
    case 'suspended':
      return (
        <Card tone="warning" title="Modo conductor suspendido">
          <Text style={styles.label}>Motivo</Text>
          <Text style={styles.body}>{view.reason}</Text>
          <Text style={styles.body}>{view.message}</Text>
        </Card>
      );
  }
}

function ApprovedPanel({ title, message }: { title: string; message: string }) {
  const { manager } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function activate() {
    setError(null);
    setLoading(true);
    const result = await activateDriverMode(manager);
    // Si cambió de modo, el layout raíz ya pasó a (driver) y esta pantalla se desmonta.
    if (result.outcome !== 'switched') {
      setError(result.message);
      setLoading(false);
    }
  }

  return (
    <Card tone="success" title={title}>
      <Text style={styles.body}>{message}</Text>
      <ErrorMessage>{error}</ErrorMessage>
      <Button title="Pasar a modo conductor" onPress={() => void activate()} loading={loading} />
    </Card>
  );
}

function Card({
  tone,
  title,
  children,
}: {
  tone: keyof typeof TONES;
  title: string;
  children: React.ReactNode;
}) {
  const palette = TONES[tone];
  return (
    <View style={[styles.card, { borderColor: palette.color }]}>
      <View style={styles.cardHeader}>
        <MaterialCommunityIcons name={palette.icon} size={28} color={palette.color} />
        <Text accessibilityRole="header" style={[styles.cardTitle, { color: palette.color }]}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
  },
  noticeText: { flex: 1, fontSize: 15, fontWeight: '600' },
  card: { gap: 8, padding: 16, borderRadius: 12, borderWidth: 1, alignSelf: 'stretch' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { flex: 1, fontSize: 19, fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '700', color: colors.muted, marginTop: 4 },
  body: { fontSize: 16, color: colors.text },
});
