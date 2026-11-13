// Acceso de React al store de sesión. El estado vive en `SessionManager` (TypeScript puro) y
// los componentes se suscriben con `useSyncExternalStore`: sin dependencias extra y con la
// lógica probada fuera de React.
import { createContext, type ReactNode, useContext, useEffect, useSyncExternalStore } from 'react';
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
    void manager.load();
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
