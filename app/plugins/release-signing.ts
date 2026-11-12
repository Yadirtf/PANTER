// Transformación pura de android/app/build.gradle para firmar el build de release con la
// llave de subida de PANTER (HU-008). La usa el config plugin `with-release-signing.ts`
// tras `expo prebuild`, porque android/ se regenera en cada build y no se versiona.
//
// La llave se lee en tiempo de Gradle de variables de entorno (o propiedades -P / gradle.properties):
//   PANTER_UPLOAD_STORE_FILE      ruta al keystore (.jks)
//   PANTER_UPLOAD_STORE_PASSWORD  contraseña del keystore
//   PANTER_UPLOAD_KEY_ALIAS       alias de la llave
//   PANTER_UPLOAD_KEY_PASSWORD    contraseña de la llave
//   PANTER_REQUIRE_RELEASE_SIGNING=true  falla si no hay keystore (app.yml)
// Sin PANTER_UPLOAD_STORE_FILE, el release se firma con la llave debug (comportamiento de Expo).

export const SIGNING_MARKER = '// @panter/release-signing';

export const SIGNING_ENV_VARS = [
  'PANTER_UPLOAD_STORE_FILE',
  'PANTER_UPLOAD_STORE_PASSWORD',
  'PANTER_UPLOAD_KEY_ALIAS',
  'PANTER_UPLOAD_KEY_PASSWORD',
] as const;

const HELPERS = `${SIGNING_MARKER}: firma de release con la llave de subida (ver app/plugins).
def panterSigningValue = { String name ->
    def value = System.getenv(name) ?: project.findProperty(name)
    return value ? value.toString() : null
}
def panterReleaseStoreFile = panterSigningValue('PANTER_UPLOAD_STORE_FILE')
def panterReleaseSigning = panterReleaseStoreFile != null
if (panterReleaseSigning) {
    ['PANTER_UPLOAD_STORE_PASSWORD', 'PANTER_UPLOAD_KEY_ALIAS', 'PANTER_UPLOAD_KEY_PASSWORD'].each { name ->
        if (panterSigningValue(name) == null) {
            throw new GradleException("Falta \${name} para firmar el release con PANTER_UPLOAD_STORE_FILE.")
        }
    }
} else if (panterSigningValue('PANTER_REQUIRE_RELEASE_SIGNING') == 'true') {
    throw new GradleException('PANTER_REQUIRE_RELEASE_SIGNING=true pero no se definió PANTER_UPLOAD_STORE_FILE.')
}

`;

const RELEASE_SIGNING_CONFIG = `
        release {
            if (panterReleaseSigning) {
                storeFile file(panterReleaseStoreFile)
                storePassword panterSigningValue('PANTER_UPLOAD_STORE_PASSWORD')
                keyAlias panterSigningValue('PANTER_UPLOAD_KEY_ALIAS')
                keyPassword panterSigningValue('PANTER_UPLOAD_KEY_PASSWORD')
            }
        }`;

const ANDROID_BLOCK = /^android\s*\{/m;
const SIGNING_CONFIGS_BLOCK = /^(\s*)signingConfigs\s*\{/m;
const RELEASE_BUILD_TYPE_SIGNING =
  /(buildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/;

/**
 * Añade `signingConfigs.release` y hace que el buildType release lo use cuando hay keystore.
 * Es idempotente y lanza un error si build.gradle no tiene la forma esperada de la plantilla de Expo.
 */
export function applyReleaseSigning(buildGradle: string): string {
  if (buildGradle.includes(SIGNING_MARKER)) return buildGradle;

  if (!ANDROID_BLOCK.test(buildGradle)) {
    throw new Error('release-signing: no se encontró el bloque `android {` en build.gradle.');
  }
  if (!SIGNING_CONFIGS_BLOCK.test(buildGradle)) {
    throw new Error('release-signing: no se encontró `signingConfigs {` en build.gradle.');
  }
  if (!RELEASE_BUILD_TYPE_SIGNING.test(buildGradle)) {
    throw new Error(
      'release-signing: el buildType release no usa `signingConfig signingConfigs.debug`.',
    );
  }

  return buildGradle
    .replace(ANDROID_BLOCK, (match) => `${HELPERS}${match}`)
    .replace(SIGNING_CONFIGS_BLOCK, (match) => `${match}${RELEASE_SIGNING_CONFIG}`)
    .replace(
      RELEASE_BUILD_TYPE_SIGNING,
      (_match, before: string) =>
        `${before}signingConfig panterReleaseSigning ? signingConfigs.release : signingConfigs.debug`,
    );
}
