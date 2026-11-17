import type { ConfigContext } from 'expo/config';
import { afterEach, describe, expect, it } from 'vitest';
import buildConfig from './app.config';

const KEYS = [
  'APP_ENV',
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_WEB_URL',
  'APP_VERSION',
  'APP_VERSION_CODE',
] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

function withEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return buildConfig({ config: {} } as ConfigContext);
}

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('app.config', () => {
  it('usa versión y versionCode locales por defecto', () => {
    const config = withEnv({});
    expect(config.version).toBe('0.1.0');
    expect(config.android?.versionCode).toBe(1);
    expect(config.android?.package).toBe('co.panter.app.dev');
  });

  it('toma APP_VERSION y APP_VERSION_CODE del CI en production', () => {
    const config = withEnv({
      APP_ENV: 'production',
      EXPO_PUBLIC_API_URL: 'https://api.example.com',
      APP_VERSION: '0.3.0',
      APP_VERSION_CODE: '1042',
    });
    expect(config.name).toBe('PANTER');
    expect(config.version).toBe('0.3.0');
    expect(config.android?.versionCode).toBe(1042);
    expect(config.android?.package).toBe('co.panter.app');
    expect(config.extra).toEqual({
      appEnv: 'production',
      apiUrl: 'https://api.example.com',
      webUrl: null,
    });
  });

  it('deduce la URL de la web del Worker de la API o usa EXPO_PUBLIC_WEB_URL', () => {
    expect(
      withEnv({
        APP_ENV: 'staging',
        EXPO_PUBLIC_API_URL: 'https://panter-api-staging.equipo.workers.dev',
      }).extra?.webUrl,
    ).toBe('https://panter-web-staging.equipo.workers.dev');
    expect(
      withEnv({
        APP_ENV: 'production',
        EXPO_PUBLIC_API_URL: 'https://api.example.com',
        EXPO_PUBLIC_WEB_URL: 'https://panter.example.com/',
      }).extra?.webUrl,
    ).toBe('https://panter.example.com');
  });

  it('registra el plugin de firma de release sobre build.gradle', () => {
    const config = withEnv({}) as { mods?: { android?: { appBuildGradle?: unknown } } };
    expect(typeof config.mods?.android?.appBuildGradle).toBe('function');
  });

  it('rechaza versiones inválidas', () => {
    expect(() => withEnv({ APP_VERSION: 'app-v0.3.0' })).toThrow(/APP_VERSION inválida/);
    expect(() => withEnv({ APP_VERSION_CODE: '0' })).toThrow(/APP_VERSION_CODE/);
  });
});
