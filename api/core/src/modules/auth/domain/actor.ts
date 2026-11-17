import type { ActiveMode, Role } from '@panter/contracts';

/**
 * Quién hace la petición, según su access token. Lo pone `requireAuth` en el contexto y lo
 * reciben los casos de uso que autorizan (HU-104: `requireRole()`, `requireMode()`).
 */
export interface Actor {
  userId: string;
  roles: Role[];
  activeMode: ActiveMode;
  /** Identificador del token (claim `jti`), útil para auditoría. */
  tokenId?: string;
}
