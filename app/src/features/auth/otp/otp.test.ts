import { OTP_RESEND_AFTER_SECONDS } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { parseRouteParams, resendWaitSeconds, toRouteParams } from './code-params';
import { formatCountdown, sanitizeCodeInput, secondsUntilResend } from './resend-timer';

const NOW = 1_800_000_000_000;

describe('secondsUntilResend', () => {
  it('cuenta 60 s desde el envío y llega a 0', () => {
    expect(secondsUntilResend(NOW, OTP_RESEND_AFTER_SECONDS, NOW)).toBe(60);
    expect(secondsUntilResend(NOW, 60, NOW + 400)).toBe(60);
    expect(secondsUntilResend(NOW, 60, NOW + 1_000)).toBe(59);
    expect(secondsUntilResend(NOW, 60, NOW + 59_001)).toBe(1);
    expect(secondsUntilResend(NOW, 60, NOW + 60_000)).toBe(0);
    expect(secondsUntilResend(NOW, 60, NOW + 600_000)).toBe(0);
  });
});

describe('formatCountdown', () => {
  it('muestra m:ss', () => {
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(42)).toBe('0:42');
    expect(formatCountdown(5)).toBe('0:05');
    expect(formatCountdown(-1)).toBe('0:00');
  });
});

describe('sanitizeCodeInput', () => {
  it('deja solo 6 dígitos al pegar', () => {
    expect(sanitizeCodeInput(' 123 456 ', 6)).toBe('123456');
    expect(sanitizeCodeInput('Tu código PANTER es 9876543', 6)).toBe('987654');
    expect(sanitizeCodeInput('12a', 6)).toBe('12');
  });
});

describe('parámetros de /code', () => {
  it('ida y vuelta', () => {
    const params = { email: 'ana@example.com', sentAt: NOW - 5_000, resendAfter: 60 };
    expect(parseRouteParams(toRouteParams(params), NOW)).toEqual(params);
  });

  it('normaliza el correo y corrige valores inválidos', () => {
    expect(
      parseRouteParams({ email: ' Ana@Example.com ', sentAt: 'x', resendAfter: '10' }, NOW),
    ).toEqual({
      email: 'ana@example.com',
      sentAt: NOW,
      resendAfter: OTP_RESEND_AFTER_SECONDS,
    });
    expect(
      parseRouteParams({ email: ['ana@example.com'], sentAt: String(NOW + 1) }, NOW)?.sentAt,
    ).toBe(NOW);
  });

  it('sin correo válido devuelve null', () => {
    expect(parseRouteParams({}, NOW)).toBeNull();
    expect(parseRouteParams({ email: 'no-es-correo' }, NOW)).toBeNull();
  });

  it('respeta una espera mayor pedida por la API', () => {
    expect(resendWaitSeconds(undefined)).toBe(60);
    expect(resendWaitSeconds(30)).toBe(60);
    expect(resendWaitSeconds(90)).toBe(90);
  });
});
