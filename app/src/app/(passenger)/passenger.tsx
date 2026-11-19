import { Role } from '@panter/contracts';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { ModeSwitcher } from '../../features/auth/screens/mode-switcher';
import { SignOutButton } from '../../features/auth/screens/sign-out-button';
import { useSession } from '../../features/auth/session/session-context';
import { TripPlanner } from '../../features/fare-estimate/components/trip-planner';
import { Button, colors } from '../../shared/ui/form';

// Inicio provisional del pasajero: mapa (HU-303) con destino y estimado (HU-404). Pedir el
// viaje llega en M4.
export default function PassengerHomeScreen() {
  const { user } = useSession();
  const router = useRouter();
  const isDriver = user?.roles.includes(Role.DRIVER) ?? false;
  return (
    <TripPlanner
      top={
        <>
          <ModeSwitcher />
          <Text style={styles.email} numberOfLines={1}>
            {user?.email ?? ''}
          </Text>
          <View style={styles.row}>
            {isDriver ? null : (
              // Registro de conductor (HU-203); los ya aprobados cambian de modo con el selector.
              <View style={styles.cell}>
                <Button
                  title="Quiero ser conductor"
                  variant="secondary"
                  onPress={() => router.push('/driver-application')}
                />
              </View>
            )}
            <View style={styles.cell}>
              <SignOutButton />
            </View>
          </View>
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  email: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1 },
});
