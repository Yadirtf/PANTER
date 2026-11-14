// Grupo de rutas al que el layout raíz deja entrar según la sesión (sección 5.4, HU-106).
// Es solo experiencia de usuario: la autorización real la decide la API (requireRole/requireMode).
import { ActiveMode, Role } from '@panter/contracts';
import type { SessionState } from '../features/auth/session/session-manager';

export const ROOT_GROUPS = [
  '(auth)',
  '(web-only)',
  '(onboarding)',
  '(passenger)',
  '(driver)',
] as const;
export type RootGroup = (typeof ROOT_GROUPS)[number];

export type RootSession = Pick<SessionState, 'status' | 'user' | 'activeMode'>;

/** La app es para pasajeros y conductores; el personal (ADMIN, DISPATCHER, TOUR_OPERATOR) usa la web. */
export function usesMobileApp(roles: readonly Role[]): boolean {
  return roles.includes(Role.PASSENGER) || roles.includes(Role.DRIVER);
}

/** El selector de modo solo se muestra a conductores aprobados (rol DRIVER). */
export function canSwitchMode(roles: readonly Role[]): boolean {
  return roles.includes(Role.DRIVER);
}

/**
 * - Sin sesión (o cargándola) → (auth)
 * - Solo roles de personal → (web-only): aviso "Usa la web"
 * - Modo conductor sin rol DRIVER (aún sin aprobar) → (onboarding)
 * - Modo conductor con DRIVER → (driver)
 * - En cualquier otro caso → (passenger)
 */
export function resolveRootGroup(session: RootSession): RootGroup {
  const { status, user } = session;
  if (status !== 'signedIn' || !user) return '(auth)';
  if (!usesMobileApp(user.roles)) return '(web-only)';
  const mode = session.activeMode ?? user.activeMode;
  if (mode === ActiveMode.DRIVER) {
    return user.roles.includes(Role.DRIVER) ? '(driver)' : '(onboarding)';
  }
  return '(passenger)';
}
