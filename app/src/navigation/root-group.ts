// Grupo de rutas al que el layout raíz deja entrar según la sesión.
// HU-105: sin sesión (o cargándola) → (auth); con sesión → (passenger).
// HU-106 implementará la regla completa por rol y modo activo (sección 5.4).
import type { SessionState } from '../features/auth/session/session-manager';

export const ROOT_GROUPS = ['(auth)', '(onboarding)', '(passenger)', '(driver)'] as const;
export type RootGroup = (typeof ROOT_GROUPS)[number];

export type RootSession = Pick<SessionState, 'status' | 'user' | 'activeMode'>;

export function resolveRootGroup(session: RootSession): RootGroup {
  if (session.status !== 'signedIn' || !session.user) return '(auth)';
  return '(passenger)';
}
