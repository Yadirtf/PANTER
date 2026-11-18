// Aviso de privacidad con sesión (HU-109): el usuario debe aceptar la versión vigente antes de
// usar la app. Al aceptar, la sesión cambia y el layout raíz lo lleva a su grupo normal.
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage } from '../../../shared/api/error-messages';
import { ClientErrorCode, toApiError } from '../../../shared/api/errors';
import { Button, colors, ErrorMessage } from '../../../shared/ui/form';
import { useSession } from '../../auth/session/session-context';
import { acceptConsent, outcomeMessage } from '../accept-consent';
import { consentApi } from '../instance';
import { PolicyHeader, PolicySections } from './policy-content';

export const ACCEPT_LABEL = 'Leí y acepto el tratamiento de mis datos';

export function ConsentScreen() {
  const { manager } = useSession();
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setError(null);
    setLoading(true);
    try {
      const result = await acceptConsent({ api: consentApi, session: manager });
      if (result.outcome !== 'accepted') {
        // El aviso cambió: se vuelve a leer y a marcar la casilla.
        setChecked(false);
        setError(outcomeMessage(result));
      }
    } catch (err) {
      setError(errorMessage(toApiError(err)));
    } finally {
      setLoading(false);
    }
  }

  function decline() {
    Alert.alert(
      '¿No aceptas el aviso?',
      'Sin tu autorización para el tratamiento de tus datos personales no es posible usar PANTER: los necesitamos para tu cuenta, tus viajes y tu seguridad. Se cerrará la sesión.',
      [
        { text: 'Volver al aviso', style: 'cancel' },
        {
          text: 'Cerrar sesión',
          style: 'destructive',
          onPress: () => void manager.signOut(ClientErrorCode.CONSENT_DECLINED),
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        accessibilityLabel="Texto del aviso de privacidad"
      >
        <PolicyHeader />
        <Text style={styles.intro}>
          Antes de continuar, lee cómo PANTER trata tus datos personales (Ley 1581 de 2012).
        </Text>
        <PolicySections />
      </ScrollView>
      <View style={styles.footer}>
        <ErrorMessage>{error}</ErrorMessage>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked, disabled: loading }}
          disabled={loading}
          onPress={() => setChecked((value) => !value)}
          style={styles.checkRow}
          hitSlop={8}
        >
          <View style={[styles.box, checked && styles.boxChecked]}>
            {checked ? <Text style={styles.tick}>✓</Text> : null}
          </View>
          <Text style={styles.checkLabel}>{ACCEPT_LABEL}</Text>
        </Pressable>
        <Button
          title="Aceptar y continuar"
          onPress={() => void accept()}
          disabled={!checked}
          loading={loading}
        />
        <Button variant="secondary" title="No acepto" onPress={decline} disabled={loading} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { gap: 20, padding: 24 },
  intro: { fontSize: 16, color: colors.muted },
  footer: {
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  box: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: colors.primary },
  tick: { color: colors.background, fontSize: 18, fontWeight: '800' },
  checkLabel: { flex: 1, fontSize: 16, color: colors.text },
});
