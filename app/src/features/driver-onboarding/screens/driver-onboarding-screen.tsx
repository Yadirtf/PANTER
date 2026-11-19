// Registro de conductor (HU-203). Se entra desde el modo pasajero ("Quiero ser conductor") o desde
// (onboarding) al elegir el modo conductor sin estar aprobado.
import { ActiveMode } from '@panter/contracts';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage } from '../../../shared/api/error-messages';
import { toApiError } from '../../../shared/api/errors';
import { Button, colors, ErrorMessage } from '../../../shared/ui/form';
import { SignOutButton } from '../../auth/screens/sign-out-button';
import { useSession } from '../../auth/session/session-context';
import { documentRows, documentsProgress } from '../documents/document-states';
import { onboardingController } from '../instance';
import { useOnboardingState, useUploadQueue } from '../use-driver-onboarding';
import {
  displayPlate,
  EMPTY_VEHICLE_FORM,
  VEHICLE_TYPE_OPTIONS,
  vehicleFormFromProfile,
} from '../vehicle/vehicle-form';
import { DocumentsStep } from './documents-step';
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

  useEffect(() => {
    void onboardingController.refresh();
  }, []);

  const { profile } = state;
  const rows = documentRows(profile, uploads.items);
  const progress = documentsProgress(rows);

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
  } else if (!profile || editingVehicle) {
    content = (
      <VehicleStep
        initialValues={profile ? vehicleFormFromProfile(profile) : EMPTY_VEHICLE_FORM}
        onDone={() => setEditingVehicle(false)}
        onCancel={profile ? () => setEditingVehicle(false) : undefined}
      />
    );
  } else {
    const option = VEHICLE_TYPE_OPTIONS.find((o) => o.type === profile.vehicle.vehicleType);
    content = (
      <View style={styles.block}>
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
        <DocumentsStep rows={rows} progress={progress} online={uploads.online} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Registro de conductor</Text>
        <Text style={styles.subtitle}>
          Registra tu vehículo y fotografía tus documentos. Un administrador de PANTER los revisa
          antes de habilitarte el modo conductor.
        </Text>
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
