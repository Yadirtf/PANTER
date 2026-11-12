// Config plugin de Expo: inyecta la firma de release en android/app/build.gradle (HU-008).
import { type ConfigPlugin, withAppBuildGradle } from 'expo/config-plugins';
import { applyReleaseSigning } from './release-signing.ts';

export const withReleaseSigning: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== 'groovy') {
      throw new Error('release-signing: solo se soporta build.gradle en Groovy.');
    }
    gradleConfig.modResults.contents = applyReleaseSigning(gradleConfig.modResults.contents);
    return gradleConfig;
  });
