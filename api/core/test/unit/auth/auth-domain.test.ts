import { ActiveMode, MeResponseSchema, Role } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { generateOtpCode, timingSafeEqual } from '../../../src/modules/auth/domain/otp-code';
import {
  canSignIn,
  resolveActiveMode,
  sortRoles,
  toProfile,
  type User,
} from '../../../src/modules/auth/domain/user';

/** Fuente aleatoria que entrega los valores indicados en orden. */
function sequence(...values: number[]) {
  let i = 0;
  return (array: Uint32Array) => {
    array[0] = values[i++] ?? 0;
    return array;
  };
}

describe('generateOtpCode', () => {
  it('genera 6 dígitos con ceros a la izquierda', () => {
    expect(generateOtpCode(sequence(42))).toBe('000042');
    expect(generateOtpCode(sequence(999_999))).toBe('999999');
    expect(generateOtpCode(sequence(1_000_000))).toBe('000000');
  });

  it('descarta valores del rango sesgado (muestreo por rechazo)', () => {
    // Mayor múltiplo de 10^6 por debajo de 2^32 = 4_294_000_000.
    expect(generateOtpCode(sequence(4_294_000_000, 4_294_967_295, 7))).toBe('000007');
    expect(generateOtpCode(sequence(4_293_999_999))).toBe('999999');
  });

  it('usa crypto.getRandomValues por defecto', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateOtpCode()));
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(codes.size).toBeGreaterThan(190);
  });
});

describe('timingSafeEqual', () => {
  it('compara contenido y longitud', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
    expect(timingSafeEqual('a', '')).toBe(false);
  });
});

describe('cuenta', () => {
  const user: User = {
    id: '6f9619ff-8b86-4d11-b42d-00c04fc964ff',
    email: 'ana@panter.test',
    fullName: null,
    phone: null,
    status: 'ACTIVE',
    roles: [Role.DRIVER, Role.PASSENGER, Role.DRIVER],
  };

  it('solo las cuentas ACTIVE pueden iniciar sesión', () => {
    expect(canSignIn({ status: 'ACTIVE' })).toBe(true);
    expect(canSignIn({ status: 'SUSPENDED' })).toBe(false);
    expect(canSignIn({ status: 'DELETED' })).toBe(false);
  });

  it('ordena los roles como en contracts y sin duplicados', () => {
    expect(sortRoles([Role.ADMIN, Role.DRIVER, Role.PASSENGER, Role.ADMIN])).toEqual([
      Role.PASSENGER,
      Role.DRIVER,
      Role.ADMIN,
    ]);
  });

  it('modo driver solo con rol DRIVER', () => {
    expect(resolveActiveMode([Role.PASSENGER, Role.DRIVER], ActiveMode.DRIVER)).toBe('driver');
    expect(resolveActiveMode([Role.PASSENGER], ActiveMode.DRIVER)).toBe('passenger');
    expect(resolveActiveMode([Role.DRIVER], ActiveMode.PASSENGER)).toBe('passenger');
  });

  it('el perfil cumple MeResponseSchema', () => {
    const profile = toProfile(user, ActiveMode.PASSENGER);
    expect(MeResponseSchema.parse(profile)).toEqual(profile);
    expect(profile.roles).toEqual([Role.PASSENGER, Role.DRIVER]);
    expect(profile.activeMode).toBe('passenger');
  });
});
