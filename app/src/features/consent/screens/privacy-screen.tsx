// Aviso de privacidad sin sesión, solo lectura (enlace del login, HU-109).
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors } from '../../../shared/ui/form';
import { PolicyHeader, PolicySections } from './policy-content';

export function PrivacyScreen() {
  const router = useRouter();

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        accessibilityLabel="Texto del aviso de privacidad"
      >
        <PolicyHeader />
        <PolicySections />
      </ScrollView>
      <View style={styles.footer}>
        <Button variant="secondary" title="Volver" onPress={close} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { gap: 20, padding: 24 },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: colors.border },
});
