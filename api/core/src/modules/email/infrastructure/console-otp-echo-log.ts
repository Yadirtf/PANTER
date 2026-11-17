import type { OtpEchoLog } from '../application/ports';

/**
 * Escribe el código en los logs del Worker como objeto (Workers Logs lo indexa por campos):
 * `{ event: "otp_dev_echo", to, code }`. Buscar en Cloudflare → panter-api-staging → Logs.
 */
export function createConsoleOtpEchoLog(log: (entry: unknown) => void = console.log): OtpEchoLog {
  return {
    echo({ to, code }) {
      log({ event: 'otp_dev_echo', to, code });
    },
  };
}
