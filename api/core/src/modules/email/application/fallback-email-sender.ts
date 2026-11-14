import { EmailSendError, type EmailMessage, type EmailSender } from './ports';

export interface FallbackEvents {
  /** Se llama cuando el principal falla y se pasa al respaldo. */
  onPrimaryFailure?(error: unknown, primary: string, fallback: string): void;
}

/**
 * Envía con el proveedor principal y, si falla por cualquier motivo (incluido el 429 de cuota
 * diaria agotada), reintenta una vez con el de respaldo. Si ambos fallan lanza un
 * `EmailSendError` con los dos errores en `cause`.
 */
export class FallbackEmailSender implements EmailSender {
  readonly name: string;

  constructor(
    private readonly primary: EmailSender,
    private readonly fallback: EmailSender,
    private readonly events: FallbackEvents = {},
  ) {
    this.name = `${primary.name}+${fallback.name}`;
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      await this.primary.send(message);
      return;
    } catch (primaryError) {
      this.events.onPrimaryFailure?.(primaryError, this.primary.name, this.fallback.name);
      try {
        await this.fallback.send(message);
      } catch (fallbackError) {
        const reason = fallbackError instanceof EmailSendError ? fallbackError.reason : 'network';
        throw new EmailSendError(
          this.name,
          reason,
          `Fallaron ${this.primary.name} y ${this.fallback.name}`,
          { cause: [primaryError, fallbackError] },
        );
      }
    }
  }
}
