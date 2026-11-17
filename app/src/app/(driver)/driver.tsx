import { PlaceholderScreen } from '../../components/placeholder-screen';
import { ModeSwitcher } from '../../features/auth/screens/mode-switcher';
import { SignOutButton } from '../../features/auth/screens/sign-out-button';
import { useSession } from '../../features/auth/session/session-context';

export default function DriverHomeScreen() {
  const { user } = useSession();
  return (
    <PlaceholderScreen
      title="Conductor"
      description={`Disponibilidad y ofertas entrantes.\n${user?.email ?? ''}`}
    >
      <ModeSwitcher />
      <SignOutButton />
    </PlaceholderScreen>
  );
}
