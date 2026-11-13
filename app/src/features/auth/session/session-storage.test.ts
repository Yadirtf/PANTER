import { describe, expect, it } from 'vitest';
import { makeTokenPair, makeUser } from '../../../test/fake-api';
import {
  createMemoryKeyValueStore,
  createSessionStorage,
  sessionFromTokenPair,
  STORAGE_KEYS,
} from './session-storage';

const NOW = 1_800_000_000_000;

describe('sessionFromTokenPair', () => {
  it('calcula los vencimientos a partir de expiresIn y refreshExpiresIn', () => {
    const session = sessionFromTokenPair(makeTokenPair(1), NOW);
    expect(session).toEqual({
      accessToken: 'access-1',
      accessTokenExpiresAt: NOW + 15 * 60 * 1000,
      refreshToken: 'refresh-1',
      refreshTokenExpiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
      user: makeUser(),
    });
  });
});

describe('createSessionStorage', () => {
  it('guarda tokens y datos en claves separadas y los vuelve a leer', async () => {
    const kv = createMemoryKeyValueStore();
    const storage = createSessionStorage(kv);
    const session = sessionFromTokenPair(makeTokenPair(1), NOW);

    await storage.save(session);

    expect(kv.data.get(STORAGE_KEYS.ACCESS_TOKEN)).toBe('access-1');
    expect(kv.data.get(STORAGE_KEYS.REFRESH_TOKEN)).toBe('refresh-1');
    expect(kv.data.get(STORAGE_KEYS.META)).not.toContain('refresh-1');
    await expect(storage.load()).resolves.toEqual(session);
  });

  it('las claves son válidas para expo-secure-store', () => {
    for (const key of Object.values(STORAGE_KEYS)) expect(key).toMatch(/^[\w.-]+$/);
  });

  it('sin datos devuelve null', async () => {
    await expect(createSessionStorage(createMemoryKeyValueStore()).load()).resolves.toBeNull();
  });

  it('clear borra todas las claves', async () => {
    const kv = createMemoryKeyValueStore();
    const storage = createSessionStorage(kv);
    await storage.save(sessionFromTokenPair(makeTokenPair(1), NOW));
    await storage.clear();
    expect(kv.data.size).toBe(0);
    await expect(storage.load()).resolves.toBeNull();
  });

  it.each([
    ['JSON inválido', 'no-json'],
    [
      'usuario que no cumple el contrato',
      JSON.stringify({ accessTokenExpiresAt: 1, refreshTokenExpiresAt: 2, user: { id: 'x' } }),
    ],
    ['vencimientos ausentes', JSON.stringify({ user: makeUser() })],
  ])('descarta datos corruptos (%s)', async (_name, meta) => {
    const kv = createMemoryKeyValueStore({
      [STORAGE_KEYS.ACCESS_TOKEN]: 'a',
      [STORAGE_KEYS.REFRESH_TOKEN]: 'r',
      [STORAGE_KEYS.META]: meta,
    });
    await expect(createSessionStorage(kv).load()).resolves.toBeNull();
    expect(kv.data.size).toBe(0);
  });

  it('sin refresh token no hay sesión', async () => {
    const kv = createMemoryKeyValueStore();
    const storage = createSessionStorage(kv);
    await storage.save(sessionFromTokenPair(makeTokenPair(1), NOW));
    kv.data.delete(STORAGE_KEYS.REFRESH_TOKEN);
    await expect(storage.load()).resolves.toBeNull();
  });
});
