import type { Env } from '../env';
import { FallbackEmailSender } from '../modules/email/application/fallback-email-sender';
import type { EmailSender } from '../modules/email/application/ports';
import { makeSendOtpEmail, type SendOtpEmail } from '../modules/email/application/send-otp-email';
import { devEchoPolicy } from '../modules/email/domain/dev-echo';
import { BrevoEmailSender } from '../modules/email/infrastructure/brevo-email-sender';
import { createConsoleOtpEchoLog } from '../modules/email/infrastructure/console-otp-echo-log';
import type { FetchLike } from '../modules/email/infrastructure/provider-http';
import { ResendEmailSender } from '../modules/email/infrastructure/resend-email-sender';
import { requireConfig } from './config';

export type EmailEnv = Pick<
  Env,
  | 'ENVIRONMENT'
  | 'EMAIL_PROVIDER'
  | 'EMAIL_FROM'
  | 'EMAIL_FROM_NAME'
  | 'BREVO_API_KEY'
  | 'RESEND_API_KEY'
  | 'OTP_DEV_ECHO'
  | 'OTP_DEV_ECHO_ALLOWLIST'
>;

export const EMAIL_PROVIDERS = ['brevo', 'resend'] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];
const DEFAULT_FROM_NAME = 'PANTER';

function parseProvider(value: string | undefined): EmailProvider {
  const provider = (value?.trim().toLowerCase() || 'brevo') as EmailProvider;
  if (!EMAIL_PROVIDERS.includes(provider)) {
    throw new Error(`EMAIL_PROVIDER inválido: "${value}". Valores: ${EMAIL_PROVIDERS.join(', ')}.`);
  }
  return provider;
}

function buildProvider(
  provider: EmailProvider,
  apiKey: string,
  from: { fromEmail: string; fromName: string },
  fetchFn: FetchLike | undefined,
): EmailSender {
  const config = { apiKey, ...from, fetch: fetchFn };
  return provider === 'brevo' ? new BrevoEmailSender(config) : new ResendEmailSender(config);
}

function apiKeyOf(env: EmailEnv, provider: EmailProvider): string | undefined {
  return provider === 'brevo' ? env.BREVO_API_KEY : env.RESEND_API_KEY;
}

/**
 * Proveedor de correo según `EMAIL_PROVIDER` ("brevo" por defecto). El secreto del principal
 * es obligatorio; el otro proveedor queda de respaldo automático solo si su secreto existe.
 */
export function buildEmailSender(env: EmailEnv, fetchFn?: FetchLike): EmailSender {
  const primaryName = parseProvider(env.EMAIL_PROVIDER);
  const secondaryName: EmailProvider = primaryName === 'brevo' ? 'resend' : 'brevo';
  const from = {
    fromEmail: requireConfig(env.EMAIL_FROM, 'EMAIL_FROM', 'var'),
    fromName: env.EMAIL_FROM_NAME?.trim() || DEFAULT_FROM_NAME,
  };
  const primaryKey = requireConfig(
    apiKeyOf(env, primaryName),
    `${primaryName.toUpperCase()}_API_KEY`,
    'secreto',
  );
  const primary = buildProvider(primaryName, primaryKey, from, fetchFn);

  const secondaryKey = apiKeyOf(env, secondaryName)?.trim();
  if (!secondaryKey) return primary;
  const secondary = buildProvider(secondaryName, secondaryKey, from, fetchFn);
  return new FallbackEmailSender(primary, secondary, {
    onPrimaryFailure: (error, p, f) =>
      console.warn({
        event: 'email_fallback',
        primary: p,
        fallback: f,
        error: error instanceof Error ? error.message : String(error),
      }),
  });
}

/** Caso de uso "enviar OTP por correo" armado para el ambiente (incluye OTP_DEV_ECHO). */
export function buildSendOtpEmail(env: EmailEnv, fetchFn?: FetchLike): SendOtpEmail {
  return makeSendOtpEmail({
    sender: buildEmailSender(env, fetchFn),
    echoLog: createConsoleOtpEchoLog(),
    shouldEcho: devEchoPolicy({
      environment: env.ENVIRONMENT,
      enabled: env.OTP_DEV_ECHO,
      allowlist: env.OTP_DEV_ECHO_ALLOWLIST,
    }),
    onEchoedSendFailure: (error) =>
      console.warn({
        event: 'otp_email_failed_echoed',
        error: error instanceof Error ? error.message : String(error),
      }),
  });
}
