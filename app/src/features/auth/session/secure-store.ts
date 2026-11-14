// Adaptador de expo-secure-store (Android Keystore / iOS Keychain) para la sesión.
import * as SecureStore from 'expo-secure-store';
import type { KeyValueStore } from './session-storage';

const OPTIONS: SecureStore.SecureStoreOptions = {
  // Solo en este dispositivo y tras el primer desbloqueo: los tokens no viajan en backups.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const secureKeyValueStore: KeyValueStore = {
  getItem: (key) => SecureStore.getItemAsync(key, OPTIONS),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  deleteItem: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};
