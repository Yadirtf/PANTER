// Parámetros de la ruta /code (pantalla del código). Expo Router los pasa como texto.
import { EmailSchema, OTP_RESEND_AFTER_SECONDS } from '@panter/contracts';

export interface CodeScreenParams {
  email: string;
  /** Epoch ms del último envío del código. */
  sentAt: number;
  /** Segundos de espera para reenviar. */
  resendAfter: number;
}

/** Espera de reenvío: la del cliente (60 s) o la que pida la API si es mayor. */
export function resendWaitSeconds(fromApi: number | undefined): number {
  return Math.max(OTP_RESEND_AFTER_SECONDS, fromApi ?? 0);
}

export function toRouteParams(params: CodeScreenParams): Record<string, string> {
  return {
    email: params.email,
    sentAt: String(params.sentAt),
    resendAfter: String(params.resendAfter),
  };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Lee los parámetros; devuelve null si falta el correo (p. ej. al abrir /code directamente). */
export function parseRouteParams(
  raw: Record<string, string | string[] | undefined>,
  now: number,
): CodeScreenParams | null {
  const email = EmailSchema.safeParse(first(raw.email));
  if (!email.success) return null;
  const sentAt = Number(first(raw.sentAt));
  const resendAfter = Number(first(raw.resendAfter));
  return {
    email: email.data,
    sentAt: Number.isFinite(sentAt) && sentAt > 0 && sentAt <= now ? sentAt : now,
    resendAfter: resendWaitSeconds(Number.isFinite(resendAfter) ? resendAfter : undefined),
  };
}
