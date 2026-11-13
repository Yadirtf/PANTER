import { ApiErrorCode } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES, errorMessage } from './error-messages';
import { ApiError, ClientErrorCode, networkError, toApiError } from './errors';

describe('errorMessage', () => {
  it('tiene mensaje para cada código del contrato y del cliente', () => {
    for (const code of [...Object.values(ApiErrorCode), ...Object.values(ClientErrorCode)]) {
      expect(ERROR_MESSAGES[code], code).toMatch(/\S/);
    }
  });

  it.each([
    ['OTP_INVALID', /código no es correcto/],
    ['OTP_EXPIRED', /venció.*5 minutos/],
    ['OTP_TOO_MANY_ATTEMPTS', /5 veces/],
    ['OTP_RATE_LIMITED', /demasiados códigos.*15 minutos/],
    ['ACCOUNT_SUSPENDED', /suspendida/],
    ['VALIDATION_ERROR', /Revisa los datos/],
    ['NETWORK_ERROR', /conexión a internet/],
  ])('%s tiene un mensaje propio en español', (code, expected) => {
    expect(errorMessage(new ApiError(code, 'mensaje técnico de la API'))).toMatch(expected);
  });

  it('los códigos de login muestran mensajes distintos', () => {
    const codes = [
      'OTP_INVALID',
      'OTP_EXPIRED',
      'OTP_TOO_MANY_ATTEMPTS',
      'OTP_RATE_LIMITED',
      'ACCOUNT_SUSPENDED',
      'VALIDATION_ERROR',
      'NETWORK_ERROR',
    ] as const;
    expect(new Set(codes.map((code) => ERROR_MESSAGES[code])).size).toBe(codes.length);
  });

  it('un código desconocido muestra el mensaje genérico', () => {
    expect(errorMessage({ code: 'ALGO_NUEVO' })).toBe(ERROR_MESSAGES.INTERNAL_ERROR);
  });
});

describe('normalización', () => {
  it('networkError y toApiError producen { code, message }', () => {
    expect(networkError(new TypeError('Network request failed')).toJSON()).toEqual({
      code: 'NETWORK_ERROR',
      message: 'No se pudo conectar con la API',
    });
    expect(toApiError(new Error('boom')).toJSON()).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'boom',
    });
    const original = new ApiError('OTP_EXPIRED', 'vencido', 400);
    expect(toApiError(original)).toBe(original);
  });
});
