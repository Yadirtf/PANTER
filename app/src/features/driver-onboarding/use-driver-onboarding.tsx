// Puente de React con el onboarding: estado del controlador y de la cola de subida, y el
// componente que mantiene la cola andando mientras haya sesión (también fuera de la pantalla).
import { useEffect, useSyncExternalStore } from 'react';
import { useSession } from '../auth/session/session-context';
import { onboardingController, uploadQueue } from './instance';

export function useOnboardingState() {
  return useSyncExternalStore(
    onboardingController.subscribe,
    onboardingController.getState,
    onboardingController.getState,
  );
}

export function useUploadQueue() {
  return useSyncExternalStore(
    uploadQueue.subscribe,
    uploadQueue.getSnapshot,
    uploadQueue.getSnapshot,
  );
}

/**
 * Arranca la cola de subidas del usuario con sesión (reanuda lo pendiente tras reiniciar la app)
 * y la detiene al cerrar sesión. Se monta una vez en el layout raíz.
 */
export function DriverUploadsRunner() {
  const { status, user } = useSession();
  const userId = status === 'signedIn' ? (user?.id ?? null) : null;

  useEffect(() => {
    if (!userId) return;
    void uploadQueue.start(userId);
    return () => {
      uploadQueue.stop();
      onboardingController.reset();
    };
  }, [userId]);

  return null;
}
