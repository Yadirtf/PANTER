import { buildOtpEmail } from '../domain/otp-email';
import type { EmailSender, OtpEchoLog } from './ports';

export interface SendOtpEmailDeps {
  sender: EmailSender;
  echoLog: OtpEchoLog;
  /** Política OTP_DEV_ECHO ya evaluada para el ambiente (ver `devEchoPolicy`). */
  shouldEcho: (email: string) => boolean;
  /** Se llama si el envío falla para un correo con eco activo (el error no se propaga). */
  onEchoedSendFailure?: (error: unknown) => void;
}

/** Caso de uso: envía el correo con el código de ingreso. */
export type SendOtpEmail = (to: string, code: string) => Promise<void>;

/**
 * Arma el correo con la plantilla OTP y lo envía. Si el correo está en la lista blanca de
 * OTP_DEV_ECHO, además escribe el código en los logs; en ese caso un fallo del proveedor no
 * bloquea al tester (ya tiene el código en los logs) y solo se reporta con `onEchoedSendFailure`.
 */
export function makeSendOtpEmail(deps: SendOtpEmailDeps): SendOtpEmail {
  return async (to, code) => {
    const content = buildOtpEmail(code);
    const echoed = deps.shouldEcho(to);
    if (echoed) deps.echoLog.echo({ to, code });
    try {
      await deps.sender.send({ to, ...content });
    } catch (error) {
      if (!echoed) throw error;
      deps.onEchoedSendFailure?.(error);
    }
  };
}
