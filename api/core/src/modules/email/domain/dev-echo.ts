/**
 * Modo OTP_DEV_ECHO (especificación §7.2): en staging, para los correos de testers de una
 * lista blanca, la API también escribe el código en los logs del Worker. Así se puede probar
 * el login aunque el correo caiga en spam o tarde en llegar.
 *
 * Solo se activa si se cumplen las tres condiciones a la vez:
 * 1. `ENVIRONMENT` es exactamente "staging" (en production es imposible, valga lo que valga
 *    `OTP_DEV_ECHO`);
 * 2. `OTP_DEV_ECHO` es "true";
 * 3. el correo está en `OTP_DEV_ECHO_ALLOWLIST` (separada por comas, sin distinguir mayúsculas).
 */
export interface DevEchoSettings {
  environment: string | undefined;
  enabled: string | undefined;
  allowlist: string | undefined;
}

export const DEV_ECHO_ENVIRONMENT = 'staging';

/** "a@x.com, B@y.com" → {"a@x.com", "b@y.com"}. */
export function parseEmailAllowlist(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Devuelve la política ya evaluada: `(email) => boolean`. */
export function devEchoPolicy(settings: DevEchoSettings): (email: string) => boolean {
  const active =
    settings.environment === DEV_ECHO_ENVIRONMENT &&
    settings.enabled?.trim().toLowerCase() === 'true';
  if (!active) return () => false;
  const allowed = parseEmailAllowlist(settings.allowlist);
  return (email) => allowed.has(email.trim().toLowerCase());
}
