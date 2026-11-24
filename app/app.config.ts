// Configuración dinámica de Expo por perfil.
// APP_ENV (development | staging | production), EXPO_PUBLIC_API_URL y EXPO_PUBLIC_WEB_URL
// (opcional) llegan del entorno:
// archivo .env local (ver .env.example), variables del CI o perfiles de eas.json.
// APP_VERSION y APP_VERSION_CODE (HU-008) los fija el CI: versionName del tag app-v* y
// versionCode del número de ejecución. En local se usan 0.1.0 y 1.
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withReleaseSigning } from './plugins/with-release-signing.ts';
import {
  applicationIdSuffix,
  resolveEnvironment,
  resolveWebUrl,
} from './src/config/environment.ts';
import { resolveVersion } from './src/config/version.ts';

const BASE_APPLICATION_ID = 'co.panter.app';

/** ID del proyecto @creathor/panter en EAS (builds, credenciales y updates). */
export const EAS_PROJECT_ID = '628217fd-6974-444d-a612-5b7d86ef49b8';

/** Texto del permiso de cámara (iOS lo muestra en el diálogo; Android usa el aviso de la app). */
export const CAMERA_PERMISSION_TEXT =
  'PANTER usa la cámara para fotografiar tus documentos de conductor (cédula, licencia, tarjeta de propiedad, SOAT y revisión técnico-mecánica) y enviarlos a revisión.';

/** Texto del permiso de ubicación en primer plano (HU-303). Solo mientras la app está abierta. */
export const LOCATION_PERMISSION_TEXT =
  'PANTER usa tu ubicación mientras tienes la app abierta para mostrarte en el mapa, saber dónde recogerte y calcular la tarifa de tu viaje.';

export default ({ config }: ConfigContext): ExpoConfig => {
  const { appEnv, apiUrl } = resolveEnvironment({
    APP_ENV: process.env.APP_ENV,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  });
  // Opcional: URL de la web para el aviso a usuarios de personal (HU-106).
  const webUrl = resolveWebUrl(process.env.EXPO_PUBLIC_WEB_URL, { appEnv, apiUrl });
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
      // Fotos de los documentos de conductor (HU-203). Solo cámara: sin micrófono ni lector de
      // códigos de barras (reduce permisos y tamaño de la APK).
      [
        'expo-camera',
        {
          cameraPermission: CAMERA_PERMISSION_TEXT,
          microphonePermission: false,
          recordAudioAndroid: false,
          barcodeScannerEnabled: false,
        },
      ],
      // Ubicación en primer plano (HU-303): sin permiso de segundo plano ni servicio en primer
      // plano (el GPS en segundo plano del conductor llega en HU-502).
      [
        'expo-location',
        {
          locationWhenInUsePermission: LOCATION_PERMISSION_TEXT,
          locationAlwaysAndWhenInUsePermission: false,
          locationAlwaysPermission: false,
          motionUsagePermission: false,
          isAndroidBackgroundLocationEnabled: false,
          isAndroidForegroundServiceEnabled: false,
          isIosBackgroundLocationEnabled: false,
        },
      ],
      // Mapa nativo (HU-303). Sin opciones: MapLibre Native Android 13.6.1, la versión que
      // fija @maplibre/maplibre-react-native 11.5.1 (incluye la fuente pmtiles://).
      '@maplibre/maplibre-react-native',
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      appEnv,
      apiUrl,
      webUrl,
      // Proyecto de EAS (@creathor/panter) creado con `eas credentials`. Con config dinámica
      // EAS no puede escribirlo solo, así que se fija aquí.
      eas: {
        projectId: EAS_PROJECT_ID,
      },
    },
  });
};
