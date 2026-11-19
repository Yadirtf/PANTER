import { StyleSheet, Text } from 'react-native';
import { ModeSwitcher } from '../../features/auth/screens/mode-switcher';
import { SignOutButton } from '../../features/auth/screens/sign-out-button';
import { useSession } from '../../features/auth/session/session-context';
import { MapHomeLayout } from '../../features/map/components/map-home-layout';
import { OfflineMapPanel } from '../../features/map/components/offline-map-panel';
import { PanterMap } from '../../features/map/components/panter-map';
import { colors } from '../../shared/ui/form';

// Inicio provisional del conductor: mapa (HU-303) con la descarga para usarlo sin señal. La
// disponibilidad y las ofertas llegan en M3/M4.
export default function DriverHomeScreen() {
  const { user } = useSession();
  return (
    <MapHomeLayout
      renderMap={(bottomInset) => <PanterMap mode="driver" bottomInset={bottomInset} />}
      top={
        <>
          <ModeSwitcher />
          <Text style={styles.email} numberOfLines={1}>
            {user?.email ?? ''}
          </Text>
          <SignOutButton />
        </>
      }
      bottom={<OfflineMapPanel />}
    />
  );
}

const styles = StyleSheet.create({
  email: { fontSize: 13, color: colors.muted, textAlign: 'center' },
});
