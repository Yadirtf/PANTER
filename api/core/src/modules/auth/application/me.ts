import {
  ActiveMode,
  Role,
  type MeResponse,
  type SwitchModeBody,
  type SwitchModeResponse,
} from '@panter/contracts';
import type { Actor } from '../domain/actor';
import { canSignIn, toProfile, type User } from '../domain/user';
import { AuthErrors } from './errors';
import type {
  ActiveTripChecker,
  Clock,
  ConsentStatusReader,
  DriverAvailability,
  RefreshTokenStore,
  UserRepository,
} from './ports';
import type { IssueSession } from './session';

/**
 * Cuenta vigente del actor. El access token puede seguir vivo (hasta 15 min) después de que la
 * cuenta se suspenda o se borre: por eso los casos de uso de /me releen la base de datos.
 */
async function loadActiveUser(users: UserRepository, actor: Actor): Promise<User> {
  const user = await users.findById(actor.userId);
  if (!user) throw AuthErrors.unauthenticated();
  if (!canSignIn(user)) throw AuthErrors.accountSuspended();
  return user;
}

/** GET /me: perfil, roles actuales (de la base de datos) y modo activo del token. */
export type GetMe = (actor: Actor) => Promise<MeResponse>;

export function makeGetMe(deps: {
  users: UserRepository;
  /** Estado del consentimiento (HU-109); `required: true` → el cliente muestra el aviso. */
  consent?: ConsentStatusReader;
}): GetMe {
  return async (actor) => {
    const user = await loadActiveUser(deps.users, actor);
    return toProfile(user, actor.activeMode, await deps.consent?.(user.id));
  };
}

export interface SwitchModeDeps {
  users: UserRepository;
  activeTrips: ActiveTripChecker;
  driverAvailability: DriverAvailability;
  refreshStore: RefreshTokenStore;
  issueSession: IssueSession;
  clock?: Clock;
}

export type SwitchMode = (actor: Actor, input: SwitchModeBody) => Promise<SwitchModeResponse>;

/**
 * POST /me/mode (HU-104, §5.3): cambia el modo activo y emite un par de tokens nuevo.
 *
 * - `driver` sin el rol DRIVER (según la base de datos, no el token) → 403 `MODE_NOT_ALLOWED`.
 * - Cambio real de modo con un viaje en curso → 409 `MODE_CHANGE_ACTIVE_TRIP`. Pedir el mismo
 *   modo en el que ya está no es un cambio: solo reemite los tokens.
 * - Al pasar a `passenger` el conductor queda no disponible (`DriverAvailability`).
 * - Rotación: el access token trae `rid` (hash del refresh token de su par). El par nuevo se
 *   emite en la misma familia (sesión) con el modo nuevo guardado en el refresh, y el refresh
 *   anterior queda marcado como rotado: si alguien lo usa después, se detecta la reutilización
 *   y se revoca la sesión, igual que en POST /auth/refresh. Si la sesión ya se cerró (logout o
 *   familia revocada) → 401 `REFRESH_TOKEN_INVALID`. Un access token sin `rid` (emitido antes
 *   de este cambio) abre una familia nueva.
 */
export function makeSwitchMode(deps: SwitchModeDeps): SwitchMode {
  const now = deps.clock ?? Date.now;
  return async (actor, { mode }) => {
    const user = await loadActiveUser(deps.users, actor);
    if (mode === ActiveMode.DRIVER && !user.roles.includes(Role.DRIVER)) {
      throw AuthErrors.modeNotAllowed();
    }
    if (mode !== actor.activeMode && (await deps.activeTrips.hasActiveTrip(user.id))) {
      throw AuthErrors.modeChangeActiveTrip();
    }

    const previous = actor.refreshId ? await deps.refreshStore.get(actor.refreshId) : null;
    if (actor.refreshId) {
      const closed =
        !previous ||
        previous.userId !== user.id ||
        previous.expiresAt <= now() ||
        (await deps.refreshStore.isFamilyRevoked(previous.familyId));
      if (closed) throw AuthErrors.refreshTokenInvalid();
    }

    if (mode === ActiveMode.PASSENGER) await deps.driverAvailability.setUnavailable(user.id);

    const pair = await deps.issueSession(user, mode, previous?.familyId);
    // Se marca al final: si algo falla antes, el refresh anterior sigue sirviendo.
    if (actor.refreshId && previous && !previous.rotated) {
      await deps.refreshStore.put(actor.refreshId, { ...previous, rotated: true });
    }
    return pair;
  };
}
