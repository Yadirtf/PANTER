import { Role } from '@panter/contracts';
import { useRouter } from 'expo-router';
import { PlaceholderScreen } from '../../components/placeholder-screen';
import { ModeSwitcher } from '../../features/auth/screens/mode-switcher';
import { SignOutButton } from '../../features/auth/screens/sign-out-button';
import { useSession } from '../../features/auth/session/session-context';
import { Button } from '../../shared/ui/form';

export default function PassengerHomeScreen() {
  const { user } = useSession();
  const router = useRouter();
  const isDriver = user?.roles.includes(Role.DRIVER) ?? false;
  return (
    <PlaceholderScreen
      title="Pasajero"
      description={`Mapa para pedir un viaje.\n${user?.email ?? ''}`}
    >
      <ModeSwitcher />
      {isDriver ? null : (
        // Registro de conductor (HU-203); los ya aprobados cambian de modo con el selector.
        <Button
          title="Quiero ser conductor"
          variant="secondary"
          onPress={() => router.push('/driver-application')}
        />
      )}
      <SignOutButton />
    </PlaceholderScreen>
  );
}
