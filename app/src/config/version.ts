// Versión de la app (HU-008). El workflow app.yml calcula APP_VERSION a partir del tag
// `app-v<versión>` y APP_VERSION_CODE a partir del número de ejecución; `app.config.ts`
// los lleva a `expo.version` (versionName) y `android.versionCode`.
// Código puro y sin dependencias, igual que `environment.ts`.

/** Versión usada en builds locales cuando no se define APP_VERSION. */
export const DEFAULT_APP_VERSION = '0.1.0';
/** versionCode usado en builds locales cuando no se define APP_VERSION_CODE. */
export const DEFAULT_APP_VERSION_CODE = 1;
/** Máximo versionCode que acepta Google Play / Android (2100000000). */
export const MAX_VERSION_CODE = 2_100_000_000;

/** SemVer sin metadatos de build: 1.2.3 o 1.2.3-staging.4 */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

export interface AppVersion {
  readonly version: string;
  readonly versionCode: number;
}

export interface RawVersion {
  readonly APP_VERSION?: string | undefined;
  readonly APP_VERSION_CODE?: string | undefined;
}

export function isSemver(value: string): boolean {
  return SEMVER.test(value);
}

function parseVersion(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_APP_VERSION;
  if (!isSemver(trimmed)) {
    throw new Error(`APP_VERSION inválida: "${trimmed}". Formato esperado: 1.2.3 o 1.2.3-rc.1.`);
  }
  return trimmed;
}

function parseVersionCode(value: string | undefined): number {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_APP_VERSION_CODE;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`APP_VERSION_CODE debe ser un entero positivo: "${trimmed}".`);
  }
  const code = Number(trimmed);
  if (code < 1 || code > MAX_VERSION_CODE) {
    throw new Error(`APP_VERSION_CODE fuera de rango (1..${MAX_VERSION_CODE}): ${trimmed}.`);
  }
  return code;
}

/** Valida y normaliza APP_VERSION y APP_VERSION_CODE. Lanza un error descriptivo si son inválidas. */
export function resolveVersion(raw: RawVersion): AppVersion {
  return {
    version: parseVersion(raw.APP_VERSION),
    versionCode: parseVersionCode(raw.APP_VERSION_CODE),
  };
}
