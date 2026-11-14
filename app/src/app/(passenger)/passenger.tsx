import { PlaceholderScreen } from '../../components/placeholder-screen';
import { ModeSwitcher } from '../../features/auth/screens/mode-switcher';
import { SignOutButton } from '../../features/auth/screens/sign-out-button';
import { useSession } from '../../features/auth/session/session-context';

export default function PassengerHomeScreen() {
  const { user } = useSession();
  return (
    <PlaceholderScreen
      title="Pasajero"
      description={`Mapa para pedir un viaje.\n${user?.email ?? ''}`}
    >
      <ModeSwitcher />
      <SignOutButton />
    </PlaceholderScreen>
  );
}
