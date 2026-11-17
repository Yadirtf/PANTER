import { ApiErrorCode } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { LOGIN_ERROR_MESSAGES, loginErrorMessage, requiresNewCode } from './messages';

describe('mensajes del login', () => {
  it('tiene un mensaje propio para cada código de OTP', () => {
    const otpCodes = Object.values(ApiErrorCode).filter((code) => code.startsWith('OTP_'));
    expect(otpCodes).toHaveLength(4);
    for (const code of otpCodes) expect(LOGIN_ERROR_MESSAGES[code]).toBeTruthy();
    expect(new Set(otpCodes.map(loginErrorMessage)).size).toBe(otpCodes.length);
  });

  it('usa un mensaje genérico para códigos desconocidos', () => {
    expect(loginErrorMessage('ALGO_NUEVO')).toBe('No pudimos iniciar sesión. Intenta de nuevo.');
  });

  it('pide un código nuevo solo cuando el actual ya no sirve', () => {
    expect(requiresNewCode(ApiErrorCode.OTP_EXPIRED)).toBe(true);
    expect(requiresNewCode(ApiErrorCode.OTP_TOO_MANY_ATTEMPTS)).toBe(true);
    expect(requiresNewCode(ApiErrorCode.OTP_INVALID)).toBe(false);
  });
});
