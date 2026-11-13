// Cuenta regresiva para "Reenviar código" (OTP_RESEND_AFTER_SECONDS = 60 s). Se calcula con la
// hora de envío, no restando segundos, para que no se desfase si la app pasa a segundo plano.

/** Segundos que faltan para poder reenviar (0 = ya se puede). */
export function secondsUntilResend(sentAt: number, waitSeconds: number, now: number): number {
  const remainingMs = sentAt + waitSeconds * 1000 - now;
  return remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 1000);
}

/** Formato m:ss para la cuenta regresiva visible. */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, '0')}`;
}

/** Solo dígitos y como máximo `length` (al pegar el código desde el correo). */
export function sanitizeCodeInput(text: string, length: number): string {
  return text.replace(/\D/g, '').slice(0, length);
}
