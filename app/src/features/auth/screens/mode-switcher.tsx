// Selector de modo pasajero/conductor (HU-106). Solo se muestra si el usuario tiene el rol
// DRIVER; el cambio lo hace POST /me/mode y el layout raíz cambia de grupo solo.
import { ActiveMode } from '@panter/contracts';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { canSwitchMode } from '../../../navigation/root-group';
import { errorMessage } from '../../../shared/api/error-messages';
import { toApiError } from '../../../shared/api/errors';
import { colors, ErrorMessage } from '../../../shared/ui/form';
import { useSession } from '../session/session-context';

const OPTIONS: { mode: ActiveMode; label: string }[] = [
  { mode: ActiveMode.PASSENGER, label: 'Pasajero' },
  { mode: ActiveMode.DRIVER, label: 'Conductor' },
];

export function ModeSwitcher() {
  const { user, activeMode, manager } = useSession();
  const [pending, setPending] = useState<ActiveMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user || !canSwitchMode(user.roles)) return null;

  async function select(mode: ActiveMode) {
    if (mode === activeMode || pending) return;
    setError(null);
    setPending(mode);
    try {
      await manager.switchMode(mode);
    } catch (err) {
      setError(errorMessage(toApiError(err)));
    } finally {
      setPending(null);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Usar PANTER como</Text>
      <View style={styles.segment} accessibilityRole="radiogroup">
        {OPTIONS.map(({ mode, label }) => {
          const selected = mode === activeMode;
          return (
            <Pressable
              key={mode}
              accessibilityRole="radio"
              accessibilityState={{ selected, busy: pending === mode }}
              disabled={pending !== null}
              onPress={() => void select(mode)}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                {pending === mode ? 'Cambiando…' : label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <ErrorMessage>{error}</ErrorMessage>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'stretch', gap: 8 },
  label: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    overflow: 'hidden',
  },
  option: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  optionSelected: { backgroundColor: colors.primary },
  optionText: { fontSize: 16, fontWeight: '600', color: colors.primary },
  optionTextSelected: { color: colors.background },
});
