import { describe, expect, it } from 'vitest';
import { applicationIdSuffix, DEFAULT_DEV_API_URL, resolveEnvironment } from './environment';

describe('resolveEnvironment', () => {
  it('usa development y la API local por defecto', () => {
    expect(resolveEnvironment({})).toEqual({ appEnv: 'development', apiUrl: DEFAULT_DEV_API_URL });
  });

  it('resuelve staging y production con su URL https y sin barra final', () => {
    expect(
      resolveEnvironment({
        APP_ENV: 'staging',
        EXPO_PUBLIC_API_URL: 'https://api-staging.example.com/',
      }),
    ).toEqual({ appEnv: 'staging', apiUrl: 'https://api-staging.example.com' });
    expect(
      resolveEnvironment({ APP_ENV: 'production', EXPO_PUBLIC_API_URL: 'https://api.example.com' }),
    ).toEqual({ appEnv: 'production', apiUrl: 'https://api.example.com' });
  });

  it('exige EXPO_PUBLIC_API_URL fuera de development', () => {
    expect(() => resolveEnvironment({ APP_ENV: 'staging' })).toThrow(/obligatoria/);
    expect(() => resolveEnvironment({ APP_ENV: 'production', EXPO_PUBLIC_API_URL: ' ' })).toThrow(
      /obligatoria/,
    );
  });

  it('exige https fuera de development', () => {
    expect(() =>
      resolveEnvironment({ APP_ENV: 'production', EXPO_PUBLIC_API_URL: 'http://api.example.com' }),
    ).toThrow(/https/);
    expect(
      resolveEnvironment({ APP_ENV: 'development', EXPO_PUBLIC_API_URL: 'http://10.0.2.2:8787' })
        .apiUrl,
    ).toBe('http://10.0.2.2:8787');
  });

  it('rechaza perfiles y URL inválidos', () => {
    expect(() => resolveEnvironment({ APP_ENV: 'qa' })).toThrow(/APP_ENV inválido/);
    expect(() => resolveEnvironment({ EXPO_PUBLIC_API_URL: 'no-es-url' })).toThrow(/URL válida/);
    expect(() => resolveEnvironment({ EXPO_PUBLIC_API_URL: 'ftp://api.example.com' })).toThrow(
      /http o https/,
    );
  });
});

describe('applicationIdSuffix', () => {
  it('distingue los perfiles en el identificador Android', () => {
    expect(applicationIdSuffix('production')).toBe('');
    expect(applicationIdSuffix('staging')).toBe('.staging');
    expect(applicationIdSuffix('development')).toBe('.dev');
  });
});
