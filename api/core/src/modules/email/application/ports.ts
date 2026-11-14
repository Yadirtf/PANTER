import type { EmailMessage } from '../domain/email-message';

export type { EmailMessage };

/** Puerto: envía un correo transaccional. Lanza `EmailSendError` si el proveedor no lo acepta. */
export interface EmailSender {
  /** Nombre del proveedor (para logs). */
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/**
 * Motivo del fallo:
 * - `rate_limited`: 429, límite por segundo o cuota diaria agotada (Brevo 300/día, Resend 100/día);
 * - `rejected`: el proveedor rechazó la petición (credenciales, remitente no verificado, datos);
 * - `unavailable`: 5xx del proveedor;
 * - `network`: error de red o tiempo de espera agotado.
 */
export type EmailFailureReason = 'rate_limited' | 'rejected' | 'unavailable' | 'network';

export class EmailSendError extends Error {
  readonly provider: string;
  readonly reason: EmailFailureReason;
  readonly status?: number;

  constructor(
    provider: string,
    reason: EmailFailureReason,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'EmailSendError';
    this.provider = provider;
    this.reason = reason;
    this.status = options.status;
  }
}

/** Puerto: escribe el código en los logs (modo OTP_DEV_ECHO). */
export interface OtpEchoLog {
  echo(entry: { to: string; code: string }): void;
}
