// Store de sesión de la app (HU-105). Es TypeScript puro, sin React: la lógica de tokens,
// refresco y persistencia se prueba en Node, y React la consume con `useSyncExternalStore`
// (ver session-context.tsx).
import {
  type ActiveMode,
  ApiErrorCode,
  type MeResponse,
  type TokenPairResponse,
} from '@panter/contracts';
import { ApiError, isApiError } from '../../../shared/api/errors';
import type { AuthHandler } from '../../../shared/api/http-client';
import type { AuthApi } from '../api/auth-api';
import { type SessionStorage, type StoredSession, sessionFromTokenPair } from './session-storage';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

export interface SessionState {
  readonly status: SessionStatus;
  readonly user: MeResponse | null;
  readonly activeMode: ActiveMode | null;
  /** Código del error que cerró la sesión sin que el usuario lo pidiera (p. ej. refresh inválido). */
  readonly signedOutReason: string | null;
}

export interface SessionManagerOptions {
  api: AuthApi;
  storage: SessionStorage;
  now?: () => number;
  /** Margen antes del vencimiento del access token para refrescarlo por adelantado. */
  refreshSkewMs?: number;
}

/** Refrescar si al access token le queda menos de esto (el TTL es de 15 min). */
export const DEFAULT_REFRESH_SKEW_MS = 60_000;

/** Errores del refresh que significan que la sesión ya no sirve: se cierra y se va al login. */
const TERMINAL_REFRESH_CODES = new Set<string>([
  ApiErrorCode.REFRESH_TOKEN_INVALID,
  ApiErrorCode.UNAUTHENTICATED,
  ApiErrorCode.ACCOUNT_SUSPENDED,
]);

const INITIAL_STATE: SessionState = {
  status: 'loading',
  user: null,
  activeMode: null,
  signedOutReason: null,
};

type Listener = () => void;

export class SessionManager implements AuthHandler {
  private readonly api: AuthApi;
  private readonly storage: SessionStorage;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;

  private state: SessionState = INITIAL_STATE;
  private session: StoredSession | null = null;
  private readonly listeners = new Set<Listener>();
  private loadPromise: Promise<void> | null = null;
  private refreshing: Promise<string> | null = null;
  /** Cambia en cada login o cierre de sesión; descarta refrescos de una sesión anterior. */
  private epoch = 0;

  constructor(options: SessionManagerOptions) {
    this.api = options.api;
    this.storage = options.storage;
    this.now = options.now ?? Date.now;
    this.refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  }

  // --- Suscripción (useSyncExternalStore) ---

  getState = (): SessionState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setState(next: SessionState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private setSession(session: StoredSession): void {
    this.session = session;
    this.setState({
      status: 'signedIn',
      user: session.user,
      activeMode: session.user.activeMode,
      signedOutReason: null,
    });
  }

  private setSignedOut(reason: string | null): void {
    this.session = null;
    this.setState({ status: 'signedOut', user: null, activeMode: null, signedOutReason: reason });
  }

  // --- Ciclo de vida ---

  /** Carga la sesión guardada. Idempotente: varias llamadas comparten la misma carga. */
  load(): Promise<void> {
    this.loadPromise ??= this.loadFromStorage();
    return this.loadPromise;
  }

  private async loadFromStorage(): Promise<void> {
    let stored: StoredSession | null;
    try {
      stored = await this.storage.load();
    } catch {
      stored = null;
    }
    if (!stored) {
      this.setSignedOut(null);
      return;
    }
    if (stored.refreshTokenExpiresAt <= this.now()) {
      await this.expire(ApiErrorCode.REFRESH_TOKEN_INVALID);
      return;
    }
    this.setSession(stored);
  }

  /** Guarda el par de tokens de login, refresh o cambio de modo y marca la sesión activa. */
  async applyTokenPair(pair: TokenPairResponse): Promise<void> {
    const session = sessionFromTokenPair(pair, this.now());
    await this.storage.save(session);
    this.setSession(session);
  }

  /** Login exitoso (POST /auth/otp/verify). */
  async signIn(pair: TokenPairResponse): Promise<void> {
    this.epoch += 1;
    this.refreshing = null;
    await this.applyTokenPair(pair);
  }

  /** Cierre pedido por el usuario: revoca el refresh token en la API y borra el almacenamiento. */
  async signOut(): Promise<void> {
    const session = this.session;
    await this.expire(null);
    if (!session) return;
    try {
      const accessValid = session.accessTokenExpiresAt > this.now();
      await this.api.logout(
        { refreshToken: session.refreshToken },
        accessValid ? session.accessToken : undefined,
      );
    } catch {
      // Sin red o token ya revocado: la sesión local ya se borró y el refresh token vence solo.
    }
  }

  /** Cierra la sesión local sin llamar a la API (la sesión ya no es válida). */
  private async expire(reason: string | null): Promise<void> {
    this.epoch += 1;
    this.refreshing = null;
    this.setSignedOut(reason);
    try {
      await this.storage.clear();
    } catch {
      // Si el borrado falla, la próxima carga no encontrará una sesión coherente.
    }
  }

  // --- Tokens (AuthHandler del cliente HTTP) ---

  async getAccessToken(): Promise<string> {
    await this.load();
    const session = this.requireSession();
    if (session.accessTokenExpiresAt - this.refreshSkewMs > this.now()) {
      return session.accessToken;
    }
    return this.refreshAccessToken(session.accessToken);
  }

  async refreshAccessToken(staleToken: string): Promise<string> {
    await this.load();
    const session = this.requireSession();
    // Otra petición ya refrescó mientras esta esperaba: se usa el token nuevo.
    if (session.accessToken !== staleToken && !this.isExpiring(session)) {
      return session.accessToken;
    }
    if (!this.refreshing) {
      const current = this.doRefresh(session).finally(() => {
        if (this.refreshing === current) this.refreshing = null;
      });
      this.refreshing = current;
    }
    return this.refreshing;
  }

  private isExpiring(session: StoredSession): boolean {
    return session.accessTokenExpiresAt - this.refreshSkewMs <= this.now();
  }

  private requireSession(): StoredSession {
    if (!this.session) {
      throw new ApiError(ApiErrorCode.UNAUTHENTICATED, 'No hay sesión activa', 401);
    }
    return this.session;
  }

  private async doRefresh(session: StoredSession): Promise<string> {
    const epoch = this.epoch;
    if (session.refreshTokenExpiresAt <= this.now()) {
      await this.expire(ApiErrorCode.REFRESH_TOKEN_INVALID);
      throw new ApiError(ApiErrorCode.REFRESH_TOKEN_INVALID, 'La sesión venció', 401);
    }

    let pair: TokenPairResponse;
    try {
      pair = await this.api.refresh({ refreshToken: session.refreshToken });
    } catch (error) {
      if (epoch === this.epoch && isApiError(error) && TERMINAL_REFRESH_CODES.has(error.code)) {
        await this.expire(error.code);
      }
      // Sin red u otro fallo transitorio: la sesión se conserva y se reintentará después.
      throw error;
    }

    if (epoch !== this.epoch) {
      // La sesión se cerró o cambió mientras se refrescaba: el resultado ya no aplica.
      throw new ApiError(ApiErrorCode.UNAUTHENTICATED, 'La sesión cambió', 401);
    }
    await this.applyTokenPair(pair);
    return pair.accessToken;
  }
}
