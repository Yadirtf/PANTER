// Configuración de entorno en tiempo de ejecución, tipada.
// `app.config.ts` resuelve APP_ENV, EXPO_PUBLIC_API_URL y EXPO_PUBLIC_WEB_URL al construir y los deja en `extra`;
// aquí se vuelven a validar para que un build mal configurado falle al arrancar.
import Constants from 'expo-constants';
import { type AppEnvironment, resolveEnvironment, resolveWebUrl } from './environment';

interface AppExtra {
  appEnv?: string;
  apiUrl?: string;
  webUrl?: string | null;
  googleMapsConfigured?: boolean;
}

const extra = (Constants.expoConfig?.extra ?? {}) as AppExtra;

const base = resolveEnvironment({
  APP_ENV: extra.appEnv,
  EXPO_PUBLIC_API_URL: extra.apiUrl ?? process.env.EXPO_PUBLIC_API_URL,
});

export const env: AppEnvironment & {
  readonly webUrl: string | null;
  /** El build trae la clave del SDK de Google Maps (sin ella, abrir el mapa cierra la app). */
  readonly googleMapsConfigured: boolean;
} = {
  ...base,
  webUrl: resolveWebUrl(extra.webUrl ?? process.env.EXPO_PUBLIC_WEB_URL, base),
  googleMapsConfigured: extra.googleMapsConfigured === true,
};
