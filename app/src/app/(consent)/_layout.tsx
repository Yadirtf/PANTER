import { Stack } from 'expo-router';

// Aviso de privacidad pendiente (HU-109): el único grupo accesible hasta aceptarlo.
export default function ConsentLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
