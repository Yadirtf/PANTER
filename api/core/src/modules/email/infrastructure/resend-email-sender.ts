import type { EmailMessage, EmailSender } from '../application/ports';
import { EMAIL_PROVIDER_TIMEOUT_MS, postToProvider, type FetchLike } from './provider-http';

export const RESEND_API_URL = 'https://api.resend.com/emails';

export interface ResendConfig {
  apiKey: string;
  /** Remitente de un dominio verificado en Resend (p. ej. no-reply@mail.<dominio>). */
  fromEmail: string;
  fromName: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * Adaptador de Resend (`POST /emails`). Queda listo para cuando exista dominio propio
 * (especificación §7.3): Resend solo envía desde dominios verificados. Cuota gratuita: 100
 * correos al día; al agotarla responde 429 (`daily_quota_exceeded`).
 */
export class ResendEmailSender implements EmailSender {
  readonly name = 'resend';

  constructor(private readonly config: ResendConfig) {}

  async send(message: EmailMessage): Promise<void> {
    const { apiKey, fromEmail, fromName } = this.config;
    await postToProvider(
      this.name,
      this.config.fetch ?? ((input, init) => fetch(input, init)),
      RESEND_API_URL,
      { authorization: `Bearer ${apiKey}` },
      {
        from: `${fromName.replace(/[<>"]/g, '')} <${fromEmail}>`,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      },
      this.config.timeoutMs ?? EMAIL_PROVIDER_TIMEOUT_MS,
    );
  }
}
