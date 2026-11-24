// Pantalla de inicio sobre el mapa: el mapa ocupa todo y encima van un panel superior (selector
// de modo, cerrar sesión) y uno inferior (destino, tarifa…). El alto del panel
// inferior se pasa al mapa para que el botón de centrar y los avisos queden por encima.
import { type ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../../shared/ui/form';

interface MapHomeLayoutProps {
  renderMap: (bottomInset: number) => ReactNode;
  top: ReactNode;
  bottom?: ReactNode;
}

export function MapHomeLayout({ renderMap, top, bottom }: MapHomeLayoutProps) {
  const [bottomHeight, setBottomHeight] = useState(0);
  return (
    <View style={styles.flex}>
      {renderMap(bottomHeight)}
      <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.top}>
        <View style={styles.topCard}>{top}</View>
      </SafeAreaView>
      {bottom ? (
        <SafeAreaView
          edges={['bottom']}
          pointerEvents="box-none"
          style={styles.bottom}
          onLayout={(event) => setBottomHeight(event.nativeEvent.layout.height)}
        >
          {bottom}
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  top: { position: 'absolute', top: 0, left: 12, right: 12 },
  topCard: {
    marginTop: 8,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  bottom: { position: 'absolute', bottom: 0, left: 12, right: 12, paddingBottom: 12, gap: 8 },
});
