import { OTP_TTL_SECONDS } from '@panter/contracts';

/** Contenido del correo con el código de ingreso (especificación §7.4). */
export interface OtpEmailContent {
  subject: string;
  text: string;
  html: string;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * Plantilla del OTP: asunto exacto "Tu código PANTER es 123456", texto plano y HTML simple.
 * Es un correo corto y sin enlaces (ni acortados ni de ningún tipo): los filtros de spam
 * castigan los enlaces en correos de remitentes sin dominio propio.
 */
export function buildOtpEmail(code: string, ttlSeconds: number = OTP_TTL_SECONDS): OtpEmailContent {
  const minutes = Math.max(1, Math.round(ttlSeconds / 60));
  const vence = `Vence en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`;
  const subject = `Tu código PANTER es ${code}`;

  const text = [
    subject,
    '',
    `Escríbelo en la app o en la web de PANTER para ingresar. ${vence}`,
    '',
    'Si no pediste este código, ignora este correo. Nadie de PANTER te lo pedirá por teléfono ni por chat.',
    '',
    'PANTER · Villagarzón, Putumayo',
  ].join('\n');

  const safeCode = escapeHtml(code);
  const html = [
    '<!doctype html>',
    '<html lang="es">',
    '<body style="font-family:Arial,Helvetica,sans-serif;color:#1f2933;">',
    '<p>Tu código PANTER es:</p>',
    `<p style="font-size:28px;font-weight:bold;letter-spacing:6px;">${safeCode}</p>`,
    `<p>Escríbelo en la app o en la web de PANTER para ingresar. ${escapeHtml(vence)}</p>`,
    '<p>Si no pediste este código, ignora este correo. Nadie de PANTER te lo pedirá por teléfono ni por chat.</p>',
    '<p style="color:#6b7280;">PANTER · Villagarzón, Putumayo</p>',
    '</body>',
    '</html>',
  ].join('\n');

  return { subject, text, html };
}
