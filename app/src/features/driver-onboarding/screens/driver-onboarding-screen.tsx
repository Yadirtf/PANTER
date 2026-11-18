// Registro de conductor (HU-203). Se entra desde el modo pasajero ("Quiero ser conductor") o desde
// (onboarding) al elegir el modo conductor sin estar aprobado. HU-205: la pantalla refleja el
// estado de GET /drivers/me y lo refresca al volver a primer plano y al deslizar hacia abajo.
import { ActiveMode } from '@panter/contracts';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage } from '../../../shared/api/error-messages';
import { toApiError } from '../../../shared/api/errors';
import { Button, colors, ErrorMessage } from '../../../shared/ui/form';
import { SignOutButton } from '../../auth/screens/sign-out-button';
import { useSession } from '../../auth/session/session-context';
import { documentRows, documentsProgress } from '../documents/document-states';
import { onboardingController } from '../instance';
import { onboardingView } from '../status/onboarding-status';
import { isForegroundTransition, notifyDriverStatusChanged } from '../status/status-events';
import { useOnboardingState, useUploadQueue } from '../use-driver-onboarding';
import {
  displayPlate,
  EMPTY_VEHICLE_FORM,
  VEHICLE_TYPE_OPTIONS,
  vehicleFormFromProfile,
} from '../vehicle/vehicle-form';
import { DocumentsStep } from './documents-step';
import { NoticeBanner, StatusPanel } from './status-panel';
import { VehicleStep } from './vehicle-step';

export type OnboardingEntry =
  /** Grupo (onboarding): eligió modo conductor sin estar aprobado. */
  | 'driverMode'
  /** Desde el modo pasajero, con "Quiero ser conductor". */
  | 'passenger';

export function DriverOnboardingScreen({ entry }: { entry: OnboardingEntry }) {
  const state = useOnboardingState();
  const uploads = useUploadQueue();
  const [editingVehicle, setEditingVehicle] = useState(false);

  const appState = useRef<string | null>(AppState.currentState ?? null);

  useEffect(() => {
    void onboardingController.refresh();
    // Al volver a primer plano: el administrador pudo revisar la solicitud mientras tanto.
    const subscription = AppState.addEventListener('change', (next) => {
      if (isForegroundTransition(appState.current, next)) notifyDriverStatusChanged('foreground');
      appState.current = next;
    });
    return () => subscription.remove();
  }, []);

  const { profile } = state;
  const rows = documentRows(profile, uploads.items);
  const progress = documentsProgress(rows);
  const view = onboardingView(profile, rows);

  let content: React.ReactNode;
  if (state.status === 'idle' || state.status === 'loading') {
    content = (
      <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Cargando" />
    );
  } else if (state.status === 'error' && !profile) {
    content = (
      <View style={styles.block}>
        <ErrorMessage>{state.error}</ErrorMessage>
        <Button title="Reintentar" onPress={() => void onboardingController.refresh()} />
      </View>
    );
  } else if (view.kind === 'notApplied' || !profile || editingVehicle) {
    content = (
      <VehicleStep
        initialValues={profile ? vehicleFormFromProfile(profile) : EMPTY_VEHICLE_FORM}
        submitLabel={profile ? 'Enviar corrección' : 'Continuar'}
        onDone={() => setEditingVehicle(false)}
        onCancel={profile ? () => setEditingVehicle(false) : undefined}
      />
    );
  } else {
    const option = VEHICLE_TYPE_OPTIONS.find((o) => o.type === profile.vehicle.vehicleType);
    const showDocuments = view.kind === 'pending' || view.kind === 'rejected';
    content = (
      <View style={styles.block}>
        <StatusPanel view={view} onCorrectVehicle={() => setEditingVehicle(true)} />
        <View style={styles.vehicle}>
          <Text style={styles.vehicleTitle}>
            {option?.label ?? profile.vehicle.vehicleType} · {displayPlate(profile.vehicle.plate)}
          </Text>
          <Text style={styles.vehicleText}>
            {profile.vehicle.brand} {profile.vehicle.model} · {profile.vehicle.color} ·{' '}
            {profile.vehicle.year}
          </Text>
        </View>
        {state.error ? <ErrorMessage>{state.error}</ErrorMessage> : null}
        {showDocuments ? (
          <DocumentsStep
            rows={rows}
            progress={progress}
            online={uploads.online}
            // Tras un rechazo solo se vuelven a subir los documentos rechazados o faltantes.
            onlyTypes={view.kind === 'rejected' ? view.toFix : undefined}
          />
        ) : null}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={state.refreshing}
            onRefresh={() => notifyDriverStatusChanged('pull')}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        <Text style={styles.title}>Registro de conductor</Text>
        <Text style={styles.subtitle}>
          Registra tu vehículo y fotografía tus documentos. Un administrador de PANTER los revisa
          antes de habilitarte el modo conductor.
        </Text>
        {state.notice ? (
          <NoticeBanner
            notice={state.notice}
            onDismiss={() => onboardingController.dismissNotice()}
          />
        ) : null}
        {content}
        <ExitActions entry={entry} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ExitActions({ entry }: { entry: OnboardingEntry }) {
  const router = useRouter();
  const { manager } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (entry === 'passenger') {
    return <Button title="Volver" variant="secondary" onPress={() => router.back()} />;
  }

  async function backToPassenger() {
    setError(null);
    setLoading(true);
    try {
      await manager.switchMode(ActiveMode.PASSENGER);
    } catch (err) {
      setError(errorMessage(toApiError(err)));
      setLoading(false);
    }
  }

  return (
    <View style={styles.block}>
      <ErrorMessage>{error}</ErrorMessage>
      <Button
        title="Volver a modo pasajero"
        variant="secondary"
        onPress={() => void backToPassenger()}
        loading={loading}
      />
      <SignOutButton />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { gap: 16, padding: 24, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: '700', color: colors.primary },
  subtitle: { fontSize: 16, color: colors.muted },
  block: { gap: 12, alignSelf: 'stretch' },
  vehicle: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#ecf5f0',
    gap: 2,
  },
  vehicleTitle: { fontSize: 17, fontWeight: '700', color: colors.primary },
  vehicleText: { fontSize: 15, color: colors.text },
});
