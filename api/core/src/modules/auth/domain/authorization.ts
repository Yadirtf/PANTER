import type { ActiveMode, Role } from '@panter/contracts';
import type { Actor } from './actor';

/** ¿El actor tiene al menos uno de los roles? (según los claims de su access token). */
export function hasAnyRole(actor: Pick<Actor, 'roles'>, roles: readonly Role[]): boolean {
  return roles.some((role) => actor.roles.includes(role));
}

/** ¿El actor opera en ese modo? (claim `activeMode` del access token). */
export function isInMode(actor: Pick<Actor, 'activeMode'>, mode: ActiveMode): boolean {
  return actor.activeMode === mode;
}
