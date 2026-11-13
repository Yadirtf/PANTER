// Persistencia de la sesión. En la app el `KeyValueStore` es expo-secure-store (Keystore de
// Android cifrado); en las pruebas, un mapa en memoria.
import { MeResponseSchema, type MeResponse, type TokenPairResponse } from '@panter/contracts';

/** Lo mínimo de expo-secure-store que usa la sesión. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export interface StoredSession {
  readonly accessToken: string;
  /** Epoch ms en que vence el access token. */
  readonly accessTokenExpiresAt: number;
  readonly refreshToken: string;
  /** Epoch ms en que vence el refresh token. */
  readonly refreshTokenExpiresAt: number;
  readonly user: MeResponse;
}

export interface SessionStorage {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

// Claves válidas para SecureStore: solo alfanuméricos, ".", "-" y "_".
export const STORAGE_KEYS = {
  ACCESS_TOKEN: 'panter.session.accessToken',
  REFRESH_TOKEN: 'panter.session.refreshToken',
  META: 'panter.session.meta',
} as const;

interface StoredMeta {
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  user: unknown;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Construye la sesión a guardar a partir de la respuesta de login, refresh o cambio de modo. */
export function sessionFromTokenPair(pair: TokenPairResponse, now: number): StoredSession {
  return {
    accessToken: pair.accessToken,
    accessTokenExpiresAt: now + pair.expiresIn * 1000,
    refreshToken: pair.refreshToken,
    refreshTokenExpiresAt: now + pair.refreshExpiresIn * 1000,
    user: pair.user,
  };
}

export function createSessionStorage(store: KeyValueStore): SessionStorage {
  async function clear(): Promise<void> {
    await Promise.all(Object.values(STORAGE_KEYS).map((key) => store.deleteItem(key)));
  }

  return {
    async load() {
      const [accessToken, refreshToken, rawMeta] = await Promise.all([
        store.getItem(STORAGE_KEYS.ACCESS_TOKEN),
        store.getItem(STORAGE_KEYS.REFRESH_TOKEN),
        store.getItem(STORAGE_KEYS.META),
      ]);
      if (!accessToken || !refreshToken || !rawMeta) return null;

      let meta: Partial<StoredMeta>;
      try {
        meta = JSON.parse(rawMeta) as Partial<StoredMeta>;
      } catch {
        await clear();
        return null;
      }
      const user = MeResponseSchema.safeParse(meta.user);
      if (
        !user.success ||
        !isFiniteNumber(meta.accessTokenExpiresAt) ||
        !isFiniteNumber(meta.refreshTokenExpiresAt)
      ) {
        // Datos corruptos o de una versión anterior: se descartan y se pide login.
        await clear();
        return null;
      }
      return {
        accessToken,
        refreshToken,
        accessTokenExpiresAt: meta.accessTokenExpiresAt,
        refreshTokenExpiresAt: meta.refreshTokenExpiresAt,
        user: user.data,
      };
    },

    async save(session) {
      const meta: StoredMeta = {
        accessTokenExpiresAt: session.accessTokenExpiresAt,
        refreshTokenExpiresAt: session.refreshTokenExpiresAt,
        user: session.user,
      };
      // El refresh token primero: si algo falla después, la sesión se puede recuperar.
      await store.setItem(STORAGE_KEYS.REFRESH_TOKEN, session.refreshToken);
      await store.setItem(STORAGE_KEYS.ACCESS_TOKEN, session.accessToken);
      await store.setItem(STORAGE_KEYS.META, JSON.stringify(meta));
    },

    clear,
  };
}

/** Almacenamiento en memoria para pruebas. */
export function createMemoryKeyValueStore(initial: Record<string, string> = {}): KeyValueStore & {
  readonly data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    deleteItem: async (key) => {
      data.delete(key);
    },
  };
}
