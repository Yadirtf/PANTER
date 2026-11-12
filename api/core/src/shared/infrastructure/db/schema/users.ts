import { sql } from 'drizzle-orm';
import { pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { roleEnum, UserStatus, userStatusEnum } from './enums';

/** Cuentas (especificación §5.1). El correo es único sin distinguir mayúsculas. */
export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: text('email').notNull(),
    phone: text('phone'),
    fullName: text('full_name'),
    status: userStatusEnum('status').notNull().default(UserStatus.ACTIVE),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_lower_key').on(sql`lower(${t.email})`)],
);

/** Roles por usuario (§5.2 y §5.3). Una persona puede tener varios; `granted_by` es el ADMIN. */
export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserRoleRow = typeof userRoles.$inferSelect;
