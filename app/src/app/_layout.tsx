import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { resolveRootGroup } from '../navigation/root-group';

// Layout raíz. Cada grupo queda protegido por `Stack.Protected`: si el grupo activo no es
// el permitido, Expo Router redirige a la primera pantalla accesible, que hoy es (auth).
// La lógica real de sesión y modo activo llega con HU-106.
export default function RootLayout() {
  const group = resolveRootGroup();

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={group === '(auth)'}>
          <Stack.Screen name="(auth)" />
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
    </>
  );
}
