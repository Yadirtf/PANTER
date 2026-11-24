import type { ConfigContext } from 'expo/config';
import { afterEach, describe, expect, it } from 'vitest';
import buildConfig, {
  CAMERA_PERMISSION_TEXT,
  googleMapsPluginOptions,
  LOCATION_PERMISSION_TEXT,
} from './app.config';

const KEYS = [
  'APP_ENV',
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_WEB_URL',
  'APP_VERSION',
  'APP_VERSION_CODE',
  'GOOGLE_MAPS_ANDROID_API_KEY',
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
      eas: { projectId: '628217fd-6974-444d-a612-5b7d86ef49b8' },
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

  it('pide solo el permiso de cámara, con el texto en español (HU-203)', () => {
    const plugins = withEnv({}).plugins ?? [];
    const camera = plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-camera');
    expect(camera).toEqual([
      'expo-camera',
      {
        cameraPermission: CAMERA_PERMISSION_TEXT,
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: false,
      },
    ]);
    expect(CAMERA_PERMISSION_TEXT).toMatch(/^PANTER usa la cámara para fotografiar tus documentos/);
  });

  it('pide ubicación solo en primer plano, con el texto en español (HU-303)', () => {
    const plugins = withEnv({}).plugins ?? [];
    const location = plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-location',
    ) as [string, Record<string, unknown>] | undefined;
    expect(location?.[1]).toMatchObject({
      locationWhenInUsePermission: LOCATION_PERMISSION_TEXT,
      isAndroidBackgroundLocationEnabled: false,
      isAndroidForegroundServiceEnabled: false,
    });
    expect(LOCATION_PERMISSION_TEXT).toMatch(
      /^PANTER usa tu ubicación mientras tienes la app abierta/,
    );
  });

  it('mapa de Google con la clave de GOOGLE_MAPS_ANDROID_API_KEY', () => {
    const find = (env: Record<string, string>) =>
      (withEnv(env).plugins ?? []).find(
        (plugin) => Array.isArray(plugin) && plugin[0] === 'react-native-maps',
      );
    expect(find({ GOOGLE_MAPS_ANDROID_API_KEY: ' maps-key ' })).toEqual([
      'react-native-maps',
      { androidGoogleMapsApiKey: 'maps-key' },
    ]);
    expect(find({})).toEqual(['react-native-maps', {}]);
    expect(withEnv({ GOOGLE_MAPS_ANDROID_API_KEY: 'k' }).extra?.googleMapsConfigured).toBe(true);
    expect(withEnv({}).extra?.googleMapsConfigured).toBe(false);
    expect(googleMapsPluginOptions(undefined)).toEqual({});
  });
});
