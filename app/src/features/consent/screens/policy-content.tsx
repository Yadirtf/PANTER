// Texto del aviso de privacidad (el mismo de la web, en @panter/contracts). Lo usan la pantalla
// de aceptación (con sesión) y la de solo lectura del login.
import { PRIVACY_POLICY } from '@panter/contracts';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../shared/ui/form';

export function PolicyHeader() {
  return (
    <View style={styles.header}>
      <Text style={styles.brand}>PANTER</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {PRIVACY_POLICY.title}
      </Text>
      <Text style={styles.version}>
        Versión {PRIVACY_POLICY.version} · Vigente desde {PRIVACY_POLICY.effectiveFrom}
      </Text>
      {PRIVACY_POLICY.draft ? (
        <Text accessibilityRole="alert" style={styles.draft}>
          Borrador para la etapa de pruebas: este texto aún no tiene revisión legal y puede cambiar
          antes del lanzamiento. Si cambia, te pediremos aceptarlo de nuevo.
        </Text>
      ) : null}
    </View>
  );
}

export function PolicySections() {
  return (
    <View style={styles.sections}>
      {PRIVACY_POLICY.sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            {section.title}
          </Text>
          {section.paragraphs.map((paragraph) => (
            <Text key={paragraph} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: 8 },
  brand: { fontSize: 24, fontWeight: '800', color: colors.primary, letterSpacing: 2 },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  version: { fontSize: 14, color: colors.muted },
  draft: {
    fontSize: 14,
    color: '#7a4a00',
    backgroundColor: '#fff6e0',
    borderColor: '#f0c36d',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  sections: { gap: 20 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.primary },
  paragraph: { fontSize: 15, lineHeight: 22, color: colors.text },
});
