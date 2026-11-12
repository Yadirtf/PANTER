import { ActiveMode } from '@panter/contracts';
import { StyleSheet, Text } from 'react-native';
import { PlaceholderScreen } from '../../components/placeholder-screen';
import { env } from '../../config/env';

// Importa @panter/contracts para comprobar la resolución del workspace con Metro.
const MODES = Object.values(ActiveMode).join(' · ');

export default function SignInScreen() {
  return (
    <PlaceholderScreen title="PANTER" description="Ingreso con código al correo (HU-101/HU-102).">
      <Text style={styles.meta}>Modos: {MODES}</Text>
      <Text style={styles.meta}>
        {env.appEnv} · {env.apiUrl}
      </Text>
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  meta: { fontSize: 13, color: '#6b7b78' },
});
