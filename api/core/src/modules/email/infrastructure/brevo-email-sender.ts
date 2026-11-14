import type { EmailMessage, EmailSender } from '../application/ports';
import { EMAIL_PROVIDER_TIMEOUT_MS, postToProvider, type FetchLike } from './provider-http';

export const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

export interface BrevoConfig {
  apiKey: string;
  /** Remitente verificado en Brevo (Senders, Domains & Dedicated IPs → Senders). */
  fromEmail: string;
  fromName: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * Adaptador de Brevo (API transaccional `POST /v3/smtp/email`). Sin dominio propio se usa con
 * un remitente individual verificado (especificación §7.2). Cuota gratuita: 300 correos al día;
 * al agotarla Brevo responde 429 y el `FallbackEmailSender` pasa al respaldo.
 */
export class BrevoEmailSender implements EmailSender {
  readonly name = 'brevo';

  constructor(private readonly config: BrevoConfig) {}

  async send(message: EmailMessage): Promise<void> {
    const { apiKey, fromEmail, fromName } = this.config;
    await postToProvider(
      this.name,
      this.config.fetch ?? ((input, init) => fetch(input, init)),
      BREVO_API_URL,
      { 'api-key': apiKey },
      {
        sender: { email: fromEmail, name: fromName },
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        ...(message.html ? { htmlContent: message.html } : {}),
      },
      this.config.timeoutMs ?? EMAIL_PROVIDER_TIMEOUT_MS,
    );
  }
}
