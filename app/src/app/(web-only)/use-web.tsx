import { Linking, StyleSheet, Text } from 'react-native';
import { PlaceholderScreen } from '../../components/placeholder-screen';
import { env } from '../../config/env';
import { SignOutButton } from '../../features/auth/screens/sign-out-button';
import { Button, colors } from '../../shared/ui/form';

// Usuario solo con roles de personal (ADMIN, DISPATCHER, TOUR_OPERATOR): operan en la web
// (sección 5.3). La app solo le indica a dónde ir.
export default function UseWebScreen() {
  const { webUrl } = env;
  return (
    <PlaceholderScreen
      title="Usa la web"
      description="Tu cuenta es de personal de PANTER (administración, despacho u operación turística). Esas herramientas funcionan en la web, no en esta app."
    >
      {webUrl ? (
        <>
          <Text style={styles.url} selectable>
            {webUrl}
          </Text>
          <Button title="Abrir la web" onPress={() => void Linking.openURL(webUrl)} />
        </>
      ) : (
        <Text style={styles.hint}>Pide la dirección de la web al administrador de PANTER.</Text>
      )}
      <SignOutButton />
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  url: { fontSize: 16, fontWeight: '600', color: colors.primary, textAlign: 'center' },
  hint: { fontSize: 15, color: colors.muted, textAlign: 'center' },
});
