// Configuración dinámica de Expo por perfil.
// APP_ENV (development | staging | production) y EXPO_PUBLIC_API_URL llegan del entorno:
// archivo .env local (ver .env.example), variables del CI o perfiles de eas.json.
// APP_VERSION y APP_VERSION_CODE (HU-008) los fija el CI: versionName del tag app-v* y
// versionCode del número de ejecución. En local se usan 0.1.0 y 1.
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withReleaseSigning } from './plugins/with-release-signing.ts';
import { applicationIdSuffix, resolveEnvironment } from './src/config/environment.ts';
import { resolveVersion } from './src/config/version.ts';

const BASE_APPLICATION_ID = 'co.panter.app';

export default ({ config }: ConfigContext): ExpoConfig => {
  const { appEnv, apiUrl } = resolveEnvironment({
    APP_ENV: process.env.APP_ENV,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  });
  const { version, versionCode } = resolveVersion({
    APP_VERSION: process.env.APP_VERSION,
    APP_VERSION_CODE: process.env.APP_VERSION_CODE,
  });
  const nameSuffix = appEnv === 'production' ? '' : ` (${appEnv})`;

  // Firma de release con la llave de subida si hay PANTER_UPLOAD_* (ver plugins/release-signing.ts).
  return withReleaseSigning({
    ...config,
    name: `PANTER${nameSuffix}`,
    slug: 'panter',
    version,
    orientation: 'portrait',
    scheme: 'panter',
    userInterfaceStyle: 'automatic',
    android: {
      package: `${BASE_APPLICATION_ID}${applicationIdSuffix(appEnv)}`,
      versionCode,
      predictiveBackGestureEnabled: false,
    },
    ios: {
      bundleIdentifier: `${BASE_APPLICATION_ID}${applicationIdSuffix(appEnv)}`,
    },
    plugins: [
      'expo-router',
      // Development build: MapLibre RN (HU-303) no funciona en Expo Go.
      'expo-dev-client',
      // Sesión en el Keystore (HU-105); excluye los datos cifrados de los backups de Android,
      // que no se podrían descifrar al restaurarlos en otro teléfono.
      'expo-secure-store',
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      appEnv,
      apiUrl,
    },
  });
};
