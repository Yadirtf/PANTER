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

/** Valida una URL http(s) de `name` y la devuelve sin barra final. */
function parseUrl(name: string, trimmed: string, appEnv: AppEnv): string {
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${name} no es una URL válida: "${trimmed}".`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} debe usar http o https: "${trimmed}".`);
  }
  if (appEnv !== 'development' && url.protocol !== 'https:') {
    throw new Error(`${name} debe usar https en ${appEnv}: "${trimmed}".`);
  }

  // Sin barra final para poder concatenar rutas (`${apiUrl}/auth/otp/request`).
  return trimmed.replace(/\/+$/, '');
}

function parseApiUrl(value: string | undefined, appEnv: AppEnv): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    if (appEnv === 'development') return DEFAULT_DEV_API_URL;
    throw new Error(`EXPO_PUBLIC_API_URL es obligatoria para APP_ENV=${appEnv}.`);
  }
  return parseUrl('EXPO_PUBLIC_API_URL', trimmed, appEnv);
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

/** URL de la web usada en development cuando no se define EXPO_PUBLIC_WEB_URL (next dev). */
export const DEFAULT_DEV_WEB_URL = 'http://localhost:3000';

/** Worker de la API en workers.dev: `panter-api[-staging].<subdominio>.workers.dev`. */
const WORKERS_DEV_API = /^panter-api(-staging)?\.([a-z0-9-]+\.workers\.dev)$/i;

/**
 * URL de la web para el aviso "Usa la web" a los usuarios de personal (HU-106).
 * EXPO_PUBLIC_WEB_URL es opcional: si falta, en development se usa `next dev` y en staging o
 * production se deduce del Worker de la API en workers.dev (`panter-api-staging` →
 * `panter-web-staging`). Si no se puede deducir, devuelve null y la app muestra un texto sin URL.
 */
export function resolveWebUrl(
  raw: string | undefined,
  { appEnv, apiUrl }: AppEnvironment,
): string | null {
  const trimmed = raw?.trim();
  if (trimmed) return parseUrl('EXPO_PUBLIC_WEB_URL', trimmed, appEnv);
  if (appEnv === 'development') return DEFAULT_DEV_WEB_URL;
  const match = WORKERS_DEV_API.exec(new URL(apiUrl).hostname);
  return match ? `https://panter-web${match[1] ?? ''}.${match[2]}` : null;
}
