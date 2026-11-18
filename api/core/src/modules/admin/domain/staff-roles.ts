import { isStaffRole, Role, type StaffRole } from '@panter/contracts';

/**
 * Reglas de los roles de personal (HU-108, §5.3).
 * - Solo ADMIN, DISPATCHER y TOUR_OPERATOR se otorgan o retiran a mano. PASSENGER es
 *   automático y DRIVER llega con la aprobación de documentos (HU-204).
 * - Un administrador no puede retirarse su propio ADMIN. Junto con exigir que quien retira sea
 *   ADMIN activo (en la misma sentencia, ver el repositorio), esto garantiza que siempre quede
 *   al menos un administrador: quien retira el ADMIN de otro sigue siéndolo.
 */
export function isGrantable(role: Role): role is StaffRole {
  return isStaffRole(role);
}

export function isOwnAdminRevoke(actorId: string, userId: string, role: Role): boolean {
  return role === Role.ADMIN && actorId === userId;
}
