import { ActiveMode } from '@panter/contracts';
import { useState } from 'react';
import { PlaceholderScreen } from '../../components/placeholder-screen';
import { SignOutButton } from '../../features/auth/screens/sign-out-button';
import { useSession } from '../../features/auth/session/session-context';
import { errorMessage } from '../../shared/api/error-messages';
import { toApiError } from '../../shared/api/errors';
import { Button, ErrorMessage } from '../../shared/ui/form';

// Modo conductor sin rol DRIVER: el registro de conductor llega con HU-203. Mientras tanto se
// puede volver al modo pasajero.
export default function OnboardingScreen() {
  const { manager } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function backToPassenger() {
    setError(null);
    setLoading(true);
    try {
      await manager.switchMode(ActiveMode.PASSENGER);
    } catch (err) {
      setError(errorMessage(toApiError(err)));
      setLoading(false);
    }
  }

  return (
    <PlaceholderScreen
      title="Registro de conductor"
      description="Para usar el modo conductor debes ser un conductor aprobado. Aquí podrás cargar tus documentos y ver el estado de tu solicitud."
    >
      <ErrorMessage>{error}</ErrorMessage>
      <Button
        title="Volver a modo pasajero"
        onPress={() => void backToPassenger()}
        loading={loading}
      />
      <SignOutButton />
    </PlaceholderScreen>
  );
}
