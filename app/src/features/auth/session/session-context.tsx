// Acceso de React al store de sesión. El estado vive en `SessionManager` (TypeScript puro) y
// los componentes se suscriben con `useSyncExternalStore`: sin dependencias extra y con la
// lógica probada fuera de React.
import { createContext, type ReactNode, useContext, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { sessionManager as defaultManager } from './instance';
import type { SessionManager, SessionState } from './session-manager';

const SessionContext = createContext<SessionManager>(defaultManager);

export function SessionProvider({
  children,
  manager = defaultManager,
}: {
  children: ReactNode;
  manager?: SessionManager;
}) {
  useEffect(() => {
    // Lee la sesión guardada y refresca roles y modo con GET /me (HU-106).
    void manager.start();
    // Al volver a primer plano se repite GET /me: así llegan roles nuevos o una versión nueva
    // del aviso de privacidad (HU-109) sin cerrar la app.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && manager.getState().status === 'signedIn') {
        void manager.refreshProfile();
      }
    });
    return () => subscription.remove();
  }, [manager]);

  return <SessionContext.Provider value={manager}>{children}</SessionContext.Provider>;
}

export interface UseSession extends SessionState {
  readonly manager: SessionManager;
}

/** Estado de la sesión: `status`, `user`, `activeMode` y el manager para login o logout. */
export function useSession(): UseSession {
  const manager = useContext(SessionContext);
  const state = useSyncExternalStore(manager.subscribe, manager.getState, manager.getState);
  return { ...state, manager };
}
