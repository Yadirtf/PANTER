// Configuración de entorno de la app por perfil (development, staging, production).
// Código puro y sin dependencias: lo usan tanto `app.config.ts` (en Node, al construir)
// como la app en tiempo de ejecución (`src/config/env.ts`).

export const APP_ENVS = ['development', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** URL de la API usada en development cuando no se define EXPO_PUBLIC_API_URL (wrangler dev). */
export const DEFAULT_DEV_API_URL = 'http://localhost:8787';

export interface AppEnvironment {
  readonly appEnv: AppEnv;
  readonly apiUrl: string;
}

/** Variables de entorno crudas que determinan la configuración. */
export interface RawEnvironment {
  readonly APP_ENV?: string | undefined;
  readonly EXPO_PUBLIC_API_URL?: string | undefined;
}

export function isAppEnv(value: unknown): value is AppEnv {
  return typeof value === 'string' && (APP_ENVS as readonly string[]).includes(value);
}

function parseAppEnv(value: string | undefined): AppEnv {
  const trimmed = value?.trim();
  if (!trimmed) return 'development';
  if (!isAppEnv(trimmed)) {
    throw new Error(`APP_ENV inválido: "${trimmed}". Valores permitidos: ${APP_ENVS.join(', ')}.`);
  }
  return trimmed;
}

function parseApiUrl(value: string | undefined, appEnv: AppEnv): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    if (appEnv === 'development') return DEFAULT_DEV_API_URL;
    throw new Error(`EXPO_PUBLIC_API_URL es obligatoria para APP_ENV=${appEnv}.`);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`EXPO_PUBLIC_API_URL no es una URL válida: "${trimmed}".`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`EXPO_PUBLIC_API_URL debe usar http o https: "${trimmed}".`);
  }
  if (appEnv !== 'development' && url.protocol !== 'https:') {
    throw new Error(`EXPO_PUBLIC_API_URL debe usar https en ${appEnv}: "${trimmed}".`);
  }

  // Sin barra final para poder concatenar rutas (`${apiUrl}/auth/otp/request`).
  return trimmed.replace(/\/+$/, '');
}

/** Valida y normaliza las variables de entorno. Lanza un error descriptivo si son inválidas. */
export function resolveEnvironment(raw: RawEnvironment): AppEnvironment {
  const appEnv = parseAppEnv(raw.APP_ENV);
  return { appEnv, apiUrl: parseApiUrl(raw.EXPO_PUBLIC_API_URL, appEnv) };
}

/** Sufijo del identificador Android para instalar varios perfiles en el mismo teléfono. */
export function applicationIdSuffix(appEnv: AppEnv): string {
  return appEnv === 'production' ? '' : `.${appEnv === 'staging' ? 'staging' : 'dev'}`;
}
