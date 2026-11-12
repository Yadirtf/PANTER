// Configuración de entorno en tiempo de ejecución, tipada.
// `app.config.ts` resuelve APP_ENV y EXPO_PUBLIC_API_URL al construir y los deja en `extra`;
// aquí se vuelven a validar para que un build mal configurado falle al arrancar.
import Constants from 'expo-constants';
import { type AppEnvironment, resolveEnvironment } from './environment';

interface AppExtra {
  appEnv?: string;
  apiUrl?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as AppExtra;

export const env: AppEnvironment = resolveEnvironment({
  APP_ENV: extra.appEnv,
  EXPO_PUBLIC_API_URL: extra.apiUrl ?? process.env.EXPO_PUBLIC_API_URL,
});
