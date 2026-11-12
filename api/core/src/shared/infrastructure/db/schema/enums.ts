import { Role } from '@panter/contracts';
import { pgEnum } from 'drizzle-orm/pg-core';

/** Tupla no vacía con los valores de un objeto `as const`, como la pide `pgEnum`. */
function enumValues<T extends Record<string, string>>(obj: T): [T[keyof T], ...T[keyof T][]] {
  return Object.values(obj) as [T[keyof T], ...T[keyof T][]];
}

/** Enum Postgres `role` generado desde `Role` de @panter/contracts (sin duplicar valores). */
export const roleEnum = pgEnum('role', enumValues(Role));

/**
 * Estado de la cuenta. ACTIVE por defecto; SUSPENDED bloquea el acceso (decisión de un ADMIN);
 * DELETED es la baja lógica (Habeas Data, Ley 1581 de 2012).
 */
export const UserStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DELETED: 'DELETED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const userStatusEnum = pgEnum('user_status', enumValues(UserStatus));
