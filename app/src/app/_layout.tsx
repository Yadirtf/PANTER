import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SessionProvider, useSession } from '../features/auth/session/session-context';
import { DriverUploadsRunner } from '../features/driver-onboarding/use-driver-onboarding';
import { groupHome } from '../navigation/group-home';
import { resolveRootGroup } from '../navigation/root-group';
import { colors } from '../shared/ui/form';

// Layout raíz. Cada grupo queda protegido por `Stack.Protected`: el grupo permitido sale de la
// sesión (`resolveRootGroup`), así que al iniciar o cerrar sesión la navegación cambia sola.
// `redirectTo` lleva a la pantalla principal del grupo activo; sin él, Expo Router redirige a
// `/` (el login), que también queda protegido al iniciar sesión → "Unmatched Route".
export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      {/* Subidas de documentos de conductor pendientes (HU-203): siguen fuera de la pantalla. */}
      <DriverUploadsRunner />
      <RootNavigator />
    </SessionProvider>
  );
}

function RootNavigator() {
  const session = useSession();
  const group = resolveRootGroup(session);
  const home = groupHome(group);

  return (
    <View style={styles.flex}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected redirectTo={home} guard={group === '(auth)'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected redirectTo={home} guard={group === '(consent)'}>
          <Stack.Screen name="(consent)" />
        </Stack.Protected>
        <Stack.Protected redirectTo={home} guard={group === '(web-only)'}>
          <Stack.Screen name="(web-only)" />
        </Stack.Protected>
        <Stack.Protected redirectTo={home} guard={group === '(onboarding)'}>
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
        <Stack.Protected redirectTo={home} guard={group === '(passenger)'}>
          <Stack.Screen name="(passenger)" />
        </Stack.Protected>
        <Stack.Protected redirectTo={home} guard={group === '(driver)'}>
          <Stack.Screen name="(driver)" />
        </Stack.Protected>
      </Stack>
      {session.status === 'loading' ? (
        // Mientras se lee la sesión guardada se tapa (auth) para no mostrar el login un instante.
        <View style={styles.loading} accessibilityLabel="Cargando">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
