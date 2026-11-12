// Configuración dinámica de Expo por perfil.
// APP_ENV (development | staging | production) y EXPO_PUBLIC_API_URL llegan del entorno:
// archivo .env local (ver .env.example), variables del CI o perfiles de eas.json.
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { applicationIdSuffix, resolveEnvironment } from './src/config/environment.ts';

const BASE_APPLICATION_ID = 'co.panter.app';

export default ({ config }: ConfigContext): ExpoConfig => {
  const { appEnv, apiUrl } = resolveEnvironment({
    APP_ENV: process.env.APP_ENV,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  });
  const nameSuffix = appEnv === 'production' ? '' : ` (${appEnv})`;

  return {
    ...config,
    name: `PANTER${nameSuffix}`,
    slug: 'panter',
    version: '0.1.0',
    orientation: 'portrait',
    scheme: 'panter',
    userInterfaceStyle: 'automatic',
    android: {
      package: `${BASE_APPLICATION_ID}${applicationIdSuffix(appEnv)}`,
      predictiveBackGestureEnabled: false,
    },
    ios: {
      bundleIdentifier: `${BASE_APPLICATION_ID}${applicationIdSuffix(appEnv)}`,
    },
    plugins: [
      'expo-router',
      // Development build: MapLibre RN (HU-303) no funciona en Expo Go.
      'expo-dev-client',
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      appEnv,
      apiUrl,
    },
  };
};
