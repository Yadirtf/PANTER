import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SessionProvider, useSession } from '../features/auth/session/session-context';
import { resolveRootGroup } from '../navigation/root-group';
import { colors } from '../shared/ui/form';

// Layout raíz. Cada grupo queda protegido por `Stack.Protected`: si el grupo activo no es
// el permitido, Expo Router redirige a la primera pantalla accesible. El grupo sale de la
// sesión (`resolveRootGroup`): al iniciar o cerrar sesión la navegación cambia sola.
export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      <RootNavigator />
    </SessionProvider>
  );
}

function RootNavigator() {
  const session = useSession();
  const group = resolveRootGroup(session);

  return (
    <View style={styles.flex}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={group === '(auth)'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={group === '(web-only)'}>
          <Stack.Screen name="(web-only)" />
        </Stack.Protected>
        <Stack.Protected guard={group === '(onboarding)'}>
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
        <Stack.Protected guard={group === '(passenger)'}>
          <Stack.Screen name="(passenger)" />
        </Stack.Protected>
        <Stack.Protected guard={group === '(driver)'}>
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
