import { Stack } from 'expo-router';

export default function WebOnlyLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
