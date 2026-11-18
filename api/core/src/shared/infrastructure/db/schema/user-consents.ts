import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Aceptaciones del aviso de privacidad (HU-109, Ley 1581 de 2012): una fila por usuario y
 * versión aceptada, con la fecha y, si se conocen, la IP y el navegador o la app desde donde se
 * aceptó (prueba de la autorización). Aceptar de nuevo la misma versión no cambia la fecha.
 */
export const userConsents = pgTable(
  'user_consents',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.version] }),
    index('user_consents_user_accepted_idx').on(t.userId, t.acceptedAt),
  ],
);

export type UserConsentRow = typeof userConsents.$inferSelect;
