// Metro para el monorepo pnpm.
// Desde el SDK 52, `expo/metro-config` detecta el workspace (pnpm-workspace.yaml) y configura
// solo `watchFolders` y `resolver.nodeModulesPaths`; desde el SDK 54 también admite las
// dependencias aisladas (symlinks) de pnpm, así que no hace falta `node-linker=hoisted`.
// Ver https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
