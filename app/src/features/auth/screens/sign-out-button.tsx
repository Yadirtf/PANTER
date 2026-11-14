import { useState } from 'react';
import { Button } from '../../../shared/ui/form';
import { useSession } from '../session/session-context';

/** "Cerrar sesión": revoca el refresh token (POST /auth/logout) y borra la sesión guardada. */
export function SignOutButton() {
  const { manager } = useSession();
  const [loading, setLoading] = useState(false);

  return (
    <Button
      variant="secondary"
      title="Cerrar sesión"
      loading={loading}
      onPress={() => {
        setLoading(true);
        // Al terminar, el layout raíz lleva al login y esta pantalla se desmonta.
        void manager.signOut();
      }}
    />
  );
}
