import { describe, expect, it } from 'vitest';
import {
  AccessTokenClaimsSchema,
  EmailSchema,
  MeResponseSchema,
  OtpCodeSchema,
  OtpVerifyBodySchema,
  SwitchModeBodySchema,
  TokenPairResponseSchema,
} from './auth';
import { ApiErrorBodySchema } from './errors';

const me = {
  id: '3f0b7f2e-8a51-4a43-9d2c-1f1f2a3b4c5d',
  email: 'ana@example.com',
  fullName: null,
  phone: null,
  status: 'ACTIVE',
  roles: ['PASSENGER'],
  activeMode: 'passenger',
};

describe('contratos de identidad', () => {
  it('normaliza el correo y rechaza inválidos', () => {
    expect(EmailSchema.parse('  Ana@Example.COM ')).toBe('ana@example.com');
    expect(EmailSchema.safeParse('no-es-correo').success).toBe(false);
  });

  it('el código OTP tiene exactamente 6 dígitos', () => {
    expect(OtpCodeSchema.parse(' 012345 ')).toBe('012345');
    expect(OtpCodeSchema.safeParse('12345').success).toBe(false);
    expect(OtpCodeSchema.safeParse('12345a').success).toBe(false);
    expect(OtpVerifyBodySchema.safeParse({ email: 'a@b.co', code: '123456' }).success).toBe(true);
  });

  it('perfil y par de tokens', () => {
    expect(MeResponseSchema.parse(me)).toEqual(me);
    expect(MeResponseSchema.safeParse({ ...me, roles: [] }).success).toBe(false);
    const pair = {
      tokenType: 'Bearer',
      accessToken: 'a.b.c',
      expiresIn: 900,
      refreshToken: 'r',
      refreshExpiresIn: 2592000,
      user: me,
    };
    expect(TokenPairResponseSchema.parse(pair)).toEqual(pair);
  });

  it('claims del access token', () => {
    const claims = {
      sub: me.id,
      roles: ['PASSENGER', 'DRIVER'],
      activeMode: 'driver',
      iss: 'panter-api',
      aud: 'panter',
      iat: 1,
      exp: 2,
    };
    expect(AccessTokenClaimsSchema.parse(claims)).toEqual(claims);
    expect(AccessTokenClaimsSchema.safeParse({ ...claims, iss: 'otro' }).success).toBe(false);
  });

  it('cambio de modo y cuerpo de error', () => {
    expect(SwitchModeBodySchema.safeParse({ mode: 'admin' }).success).toBe(false);
    expect(
      ApiErrorBodySchema.parse({ error: { code: 'OTP_INVALID', message: 'Código incorrecto' } }),
    ).toBeTruthy();
  });
});
