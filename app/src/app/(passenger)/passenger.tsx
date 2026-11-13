import { PlaceholderScreen } from '../../components/placeholder-screen';
import { useSession } from '../../features/auth/session/session-context';
import { SignOutButton } from '../../features/auth/screens/sign-out-button';

export default function PassengerHomeScreen() {
  const { user } = useSession();
  return (
    <PlaceholderScreen
      title="Pasajero"
      description={`Mapa para pedir un viaje.\n${user?.email ?? ''}`}
    >
      <SignOutButton />
    </PlaceholderScreen>
  );
}
