import type { ConsentRecord } from '../domain/consent';

export interface AcceptConsentRecord {
  userId: string;
  version: string;
  ip: string | null;
  userAgent: string | null;
}

/** Puerto: aceptaciones del aviso de privacidad (Postgres, tabla `user_consents`). */
export interface ConsentRepository {
  /** Última aceptación del usuario (por fecha), o null si nunca aceptó. */
  latest(userId: string): Promise<ConsentRecord | null>;
  /**
   * Registra la aceptación. Si ya había aceptado esa versión, conserva la fecha original.
   * Devuelve false si la cuenta no existe.
   */
  accept(record: AcceptConsentRecord): Promise<boolean>;
}
