import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface PlaceholderScreenProps {
  title: string;
  description: string;
  children?: ReactNode;
}

/** Pantalla provisional mientras se implementan las historias de cada grupo. */
export function PlaceholderScreen({ title, description, children }: PlaceholderScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 24, fontWeight: '700', color: '#1b4332' },
  description: { fontSize: 16, color: '#40514e', textAlign: 'center' },
});
