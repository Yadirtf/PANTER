import { index, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { roleEnum } from './enums';
import { users } from './users';

/** Acción registrada en `role_audit`. */
export const roleAuditActionEnum = pgEnum('role_audit_action', ['grant', 'revoke']);

/**
 * Registro de auditoría de roles (HU-108): quién otorgó o retiró qué rol a quién y cuándo.
 * Solo guarda cambios reales (otorgar un rol que ya tenía no deja registro).
 * `actor_id` es null cuando lo hizo el sistema (p. ej. `pnpm db:grant-admin`) o si la cuenta
 * del actor se borró físicamente.
 */
export const roleAudit = pgTable(
  'role_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    action: roleAuditActionEnum('action').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('role_audit_user_at_idx').on(t.userId, t.at)],
);

export type RoleAuditRow = typeof roleAudit.$inferSelect;
