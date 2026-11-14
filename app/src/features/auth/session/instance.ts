// Instancias únicas de la app: cliente HTTP contra EXPO_PUBLIC_API_URL, API de identidad y
// store de sesión sobre expo-secure-store.
import { env } from '../../../config/env';
import { createHttpClient } from '../../../shared/api/http-client';
import { createAuthApi } from '../api/auth-api';
import { secureKeyValueStore } from './secure-store';
import { SessionManager } from './session-manager';
import { createSessionStorage } from './session-storage';

export const httpClient = createHttpClient({ baseUrl: env.apiUrl });
export const authApi = createAuthApi(httpClient);
export const sessionManager = new SessionManager({
  api: authApi,
  storage: createSessionStorage(secureKeyValueStore),
});

httpClient.setAuthHandler(sessionManager);
