import { describe, expect, it } from 'vitest';
import { EXPO_TEMPLATE_BUILD_GRADLE as template } from './__fixtures__/expo-template-build-gradle';
import { applyReleaseSigning, SIGNING_MARKER } from './release-signing';

function releaseBuildType(gradle: string): string {
  const buildTypes = gradle.slice(gradle.indexOf('buildTypes {'));
  return buildTypes.slice(buildTypes.indexOf('release {'), buildTypes.indexOf('packagingOptions'));
}

describe('applyReleaseSigning', () => {
  const patched = applyReleaseSigning(template);

  it('declara los helpers antes del bloque android', () => {
    expect(patched.indexOf(SIGNING_MARKER)).toBeGreaterThan(-1);
    expect(patched.indexOf(SIGNING_MARKER)).toBeLessThan(patched.search(/^android \{/m));
    expect(patched).toContain("panterSigningValue('PANTER_UPLOAD_STORE_FILE')");
    expect(patched).toContain('PANTER_REQUIRE_RELEASE_SIGNING');
  });

  it('añade signingConfigs.release leyendo las variables PANTER_UPLOAD_*', () => {
    const signingConfigs = patched.slice(patched.indexOf('signingConfigs {'));
    const release = signingConfigs.slice(0, signingConfigs.indexOf('buildTypes {'));
    expect(release).toContain('release {');
    expect(release).toContain('storeFile file(panterReleaseStoreFile)');
    for (const name of ['STORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD']) {
      expect(release).toContain(`panterSigningValue('PANTER_UPLOAD_${name}')`);
    }
    // La configuración debug de la plantilla sigue intacta.
    expect(release).toContain("storeFile file('debug.keystore')");
  });

  it('usa la llave de release en el buildType release y deja debug igual', () => {
    expect(releaseBuildType(patched)).toContain(
      'signingConfig panterReleaseSigning ? signingConfigs.release : signingConfigs.debug',
    );
    expect(releaseBuildType(patched)).not.toMatch(/signingConfig signingConfigs\.debug\s*$/m);
    const buildTypes = patched.slice(patched.indexOf('buildTypes {'));
    const debugType = buildTypes.slice(0, buildTypes.indexOf('release {'));
    expect(debugType).toContain('signingConfig signingConfigs.debug');
  });

  it('es idempotente', () => {
    expect(applyReleaseSigning(patched)).toBe(patched);
  });

  it('falla si build.gradle no tiene la forma esperada', () => {
    expect(() => applyReleaseSigning('apply plugin: "x"')).toThrow(/android \{/);
    expect(() => applyReleaseSigning('android {\n}\n')).toThrow(/signingConfigs/);
    expect(() =>
      applyReleaseSigning(
        'android {\n    signingConfigs {\n    }\n    buildTypes {\n        release {\n        }\n    }\n}\n',
      ),
    ).toThrow(/buildType release/);
  });
});
