import { ActiveMode, ApiErrorCode, Role, TokenPairResponseSchema } from '@panter/contracts';
import { describe, expect, it, vi } from 'vitest';
import { makeGetMe, makeSwitchMode } from '../../../src/modules/auth/application/me';
import type { ActiveTripChecker } from '../../../src/modules/auth/application/ports';
import {
  makeIssueSession,
  makeRefreshSession,
} from '../../../src/modules/auth/application/session';
import type { Actor } from '../../../src/modules/auth/domain/actor';
import { hasAnyRole, isInMode } from '../../../src/modules/auth/domain/authorization';
import { noActiveTrips } from '../../../src/modules/auth/infrastructure/pending-adapters';
import { AppError } from '../../../src/shared/errors/app-error';
import {
  fakeCodec,
  fakeSigner,
  manualClock,
  MemoryRefreshStore,
  MemoryUserRepository,
} from '../../support/auth-fakes';

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  const err = await promise.then(
    () => {
      throw new Error('se esperaba un error');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

/** Claims del fakeSigner: el "token" es `at:<json>`. */
function claimsOf(accessToken: string): { activeMode: string; refreshId?: string } {
  return JSON.parse(accessToken.slice(3)) as { activeMode: string; refreshId?: string };
}

function setup(options: { activeTrip?: boolean } = {}) {
  const clock = manualClock();
  const users = new MemoryUserRepository();
  const refreshStore = new MemoryRefreshStore();
  const codec = fakeCodec();
  let families = 0;
  const issueSession = makeIssueSession({
    signer: fakeSigner,
    refreshStore,
    codec,
    clock: clock.now,
    newId: () => `fam-${++families}`,
  });
  const activeTrips: ActiveTripChecker = { hasActiveTrip: vi.fn(async () => !!options.activeTrip) };
  const driverAvailability = { setUnavailable: vi.fn(async () => {}) };
  // HU-201: conductores sin verificación APPROVED (p. ej. SUSPENDED por un ADMIN).
  const notApproved = new Set<string>();
  const driverEligibility = { canUseDriverMode: vi.fn(async (id: string) => !notApproved.has(id)) };
  const switchMode = makeSwitchMode({
    users,
    activeTrips,
    driverAvailability,
    driverEligibility,
    refreshStore,
    issueSession,
    clock: clock.now,
  });
  const refresh = makeRefreshSession({
    refreshStore,
    codec,
    users,
    issueSession,
    clock: clock.now,
    driverEligibility,
  });

  /** Inicia sesión y devuelve el actor que tendría su access token. */
  async function signIn(
    user: { id: string; roles: Role[] },
    mode: ActiveMode = ActiveMode.PASSENGER,
  ) {
    const pair = await issueSession((await users.findById(user.id))!, mode);
    const actor: Actor = {
      userId: user.id,
      roles: user.roles,
      activeMode: pair.user.activeMode,
      refreshId: claimsOf(pair.accessToken).refreshId,
    };
    return { pair, actor };
  }

  return {
    clock,
    users,
    refreshStore,
    activeTrips,
    driverAvailability,
    driverEligibility,
    notApproved,
    switchMode,
    refresh,
    signIn,
    getMe: makeGetMe({ users }),
  };
}

const driverRoles = [Role.PASSENGER, Role.DRIVER];

describe('autorización (dominio)', () => {
  it('hasAnyRole e isInMode', () => {
    const actor = { roles: [Role.PASSENGER, Role.DISPATCHER], activeMode: ActiveMode.PASSENGER };
    expect(hasAnyRole(actor, [Role.ADMIN, Role.DISPATCHER])).toBe(true);
    expect(hasAnyRole(actor, [Role.ADMIN])).toBe(false);
    expect(isInMode(actor, ActiveMode.PASSENGER)).toBe(true);
    expect(isInMode(actor, ActiveMode.DRIVER)).toBe(false);
  });

  it('adaptador provisional: sin viajes en curso', async () => {
    expect(await noActiveTrips.hasActiveTrip('u')).toBe(false);
  });
});

describe('GET /me', () => {
  it('perfil con los roles de la base de datos y el modo del token', async () => {
    const { users, getMe } = setup();
    const user = users.add('d@panter.test', 'ACTIVE', [Role.DRIVER, Role.PASSENGER]);
    const me = await getMe({ userId: user.id, roles: [Role.PASSENGER], activeMode: 'driver' });
    expect(me).toEqual({
      id: user.id,
      email: 'd@panter.test',
      fullName: null,
      phone: null,
      status: 'ACTIVE',
      roles: ['PASSENGER', 'DRIVER'],
      activeMode: 'driver',
    });
  });

  it('modo driver del token sin el rol en la base de datos → passenger', async () => {
    const { users, getMe } = setup();
    const user = users.add('p@panter.test');
    const me = await getMe({ userId: user.id, roles: driverRoles, activeMode: 'driver' });
    expect(me.activeMode).toBe('passenger');
  });

  it('cuenta inexistente → UNAUTHENTICATED; suspendida → ACCOUNT_SUSPENDED', async () => {
    const { users, getMe } = setup();
    const gone = {
      userId: '00000000-0000-4000-8000-999999999999',
      roles: [],
      activeMode: 'passenger',
    } as const;
    expect((await errorOf(getMe({ ...gone, roles: [Role.PASSENGER] }))).code).toBe(
      ApiErrorCode.UNAUTHENTICATED,
    );
    const suspended = users.add('s@panter.test', 'SUSPENDED');
    const err = await errorOf(
      getMe({ userId: suspended.id, roles: [Role.PASSENGER], activeMode: 'passenger' }),
    );
    expect([err.code, err.status]).toEqual([ApiErrorCode.ACCOUNT_SUSPENDED, 403]);
  });
});

describe('POST /me/mode', () => {
  it('conductor pasa a driver: par nuevo en la misma sesión y refresh anterior rotado', async () => {
    const { users, signIn, switchMode, refreshStore, driverAvailability } = setup();
    const user = users.add('d@panter.test', 'ACTIVE', driverRoles);
    const { pair: first, actor } = await signIn(user);

    const pair = await switchMode(actor, { mode: ActiveMode.DRIVER });
    expect(TokenPairResponseSchema.parse(pair)).toEqual(pair);
    expect(pair.user.activeMode).toBe('driver');
    expect(claimsOf(pair.accessToken).activeMode).toBe('driver');
    expect(pair.refreshToken).not.toBe(first.refreshToken);
    expect(refreshStore.records.get(`sha(${pair.refreshToken})`)).toMatchObject({
      activeMode: 'driver',
      familyId: 'fam-1',
    });
    expect(refreshStore.records.get(`sha(${first.refreshToken})`)?.rotated).toBe(true);
    expect(driverAvailability.setUnavailable).not.toHaveBeenCalled();
  });

  it('el refresh nuevo conserva el modo; reutilizar el anterior revoca la sesión', async () => {
    const { users, signIn, switchMode, refresh, refreshStore } = setup();
    const user = users.add('d@panter.test', 'ACTIVE', driverRoles);
    const { pair: first, actor } = await signIn(user);
    const switched = await switchMode(actor, { mode: ActiveMode.DRIVER });

    const renewed = await refresh({ refreshToken: switched.refreshToken });
    expect(renewed.user.activeMode).toBe('driver');

    const err = await errorOf(refresh({ refreshToken: first.refreshToken }));
    expect(err.code).toBe(ApiErrorCode.REFRESH_TOKEN_INVALID);
    expect(refreshStore.revoked.has('fam-1')).toBe(true);
  });

  it('pasar a passenger deja al conductor no disponible', async () => {
    const { users, signIn, switchMode, driverAvailability } = setup();
    const user = users.add('d@panter.test', 'ACTIVE', driverRoles);
    const { actor } = await signIn(user, ActiveMode.DRIVER);
    expect(actor.activeMode).toBe('driver');
    const pair = await switchMode(actor, { mode: ActiveMode.PASSENGER });
    expect(pair.user.activeMode).toBe('passenger');
    expect(driverAvailability.setUnavailable).toHaveBeenCalledWith(user.id);
  });

  it('driver sin el rol DRIVER (en la base de datos) → 403 MODE_NOT_ALLOWED', async () => {
    const { users, signIn, switchMode } = setup();
    const user = users.add('p@panter.test');
    const { actor } = await signIn(user);
    // Aunque el token diga lo contrario, manda la base de datos.
    const err = await errorOf(switchMode({ ...actor, roles: driverRoles }, { mode: 'driver' }));
    expect([err.code, err.status]).toEqual([ApiErrorCode.MODE_NOT_ALLOWED, 403]);
  });

  it('HU-201: DRIVER con verificación no APPROVED (SUSPENDED) → 403 MODE_NOT_ALLOWED', async () => {
    const { users, signIn, switchMode, notApproved, driverEligibility, refreshStore } = setup();
    const user = users.add('suspendido@panter.test', 'ACTIVE', driverRoles);
    notApproved.add(user.id);
    const { pair, actor } = await signIn(user);
    const err = await errorOf(switchMode(actor, { mode: ActiveMode.DRIVER }));
    expect([err.code, err.status]).toEqual([ApiErrorCode.MODE_NOT_ALLOWED, 403]);
    expect(driverEligibility.canUseDriverMode).toHaveBeenCalledWith(user.id);
    expect(refreshStore.records.get(`sha(${pair.refreshToken})`)?.rotated).toBeUndefined();
  });

  it('HU-201: sin el rol DRIVER ni siquiera consulta la verificación', async () => {
    const { users, signIn, switchMode, driverEligibility } = setup();
    const user = users.add('p@panter.test');
    const { actor } = await signIn(user);
    await errorOf(switchMode(actor, { mode: ActiveMode.DRIVER }));
    expect(driverEligibility.canUseDriverMode).not.toHaveBeenCalled();
  });

  it('HU-201: un pasajero sin DRIVER no apaga disponibilidad al pedir passenger', async () => {
    const { users, signIn, switchMode, driverAvailability } = setup();
    const user = users.add('p@panter.test');
    const { actor } = await signIn(user, ActiveMode.DRIVER);
    await switchMode(actor, { mode: ActiveMode.PASSENGER });
    expect(driverAvailability.setUnavailable).not.toHaveBeenCalled();
  });

  it('HU-201: si lo suspenden en modo driver, el refresh sale en modo passenger', async () => {
    const { users, signIn, switchMode, refresh, notApproved } = setup();
    const user = users.add('d@panter.test', 'ACTIVE', driverRoles);
    const { actor } = await signIn(user);
    const driver = await switchMode(actor, { mode: ActiveMode.DRIVER });
    notApproved.add(user.id);
    const renewed = await refresh({ refreshToken: driver.refreshToken });
    expect(renewed.user.activeMode).toBe('passenger');
    expect(claimsOf(renewed.accessToken).activeMode).toBe('passenger');
  });

  it('con un viaje en curso → 409 MODE_CHANGE_ACTIVE_TRIP sin tocar la sesión', async () => {
    const { users, signIn, switchMode, refreshStore, driverAvailability } = setup({
      activeTrip: true,
    });
    const user = users.add('d@panter.test', 'ACTIVE', driverRoles);
    const { pair, actor } = await signIn(user, ActiveMode.DRIVER);
    const err = await errorOf(switchMode(actor, { mode: ActiveMode.PASSENGER }));
    expect([err.code, err.status]).toEqual([ApiErrorCode.MODE_CHANGE_ACTIVE_TRIP, 409]);
    expect(refreshStore.records.get(`sha(${pair.refreshToken})`)?.rotated).toBeUndefined();
    expect(driverAvailability.setUnavailable).not.toHaveBeenCalled();
  });

  it('pedir el modo actual no es un cambio: reemite aunque haya viaje en curso', async () => {
    const { users, signIn, switchMode, activeTrips } = setup({ activeTrip: true });
    const user = users.add('p@panter.test');
    const { actor } = await signIn(user);
    const pair = await switchMode(actor, { mode: ActiveMode.PASSENGER });
    expect(pair.user.activeMode).toBe('passenger');
    expect(activeTrips.hasActiveTrip).not.toHaveBeenCalled();
  });

  it('sesión cerrada (familia revocada, refresh borrado o de otra cuenta) → 401', async () => {
    const { users, signIn, switchMode, refreshStore, clock } = setup();
    const user = users.add('d@panter.test', 'ACTIVE', driverRoles);

    const a = await signIn(user);
    await refreshStore.revokeFamily('fam-1', clock.now() + 1000);
    expect((await errorOf(switchMode(a.actor, { mode: 'driver' }))).code).toBe(
      ApiErrorCode.REFRESH_TOKEN_INVALID,
    );

    const b = await signIn(user);
    await refreshStore.delete(b.actor.refreshId!);
    expect((await errorOf(switchMode(b.actor, { mode: 'driver' }))).status).toBe(401);

    const other = users.add('o@panter.test', 'ACTIVE', driverRoles);
    const c = await signIn(user);
    expect(
      (await errorOf(switchMode({ ...c.actor, userId: other.id }, { mode: 'driver' }))).code,
    ).toBe(ApiErrorCode.REFRESH_TOKEN_INVALID);

    const d = await signIn(user);
    clock.advance(31 * 24 * 3600 * 1000);
    expect((await errorOf(switchMode(d.actor, { mode: 'driver' }))).status).toBe(401);
  });

  it('access token con refresh ya rotado: emite en la misma sesión sin volver a marcar', async () => {
    const { users, signIn, switchMode, refreshStore } = setup();
    const user = users.add('d@panter.test', 'ACTIVE', driverRoles);
    const { actor } = await signIn(user);
    const rotated = { ...refreshStore.records.get(actor.refreshId!)!, rotated: true };
    await refreshStore.put(actor.refreshId!, rotated);
    const put = vi.spyOn(refreshStore, 'put');
    const pair = await switchMode(actor, { mode: 'driver' });
    expect(refreshStore.records.get(`sha(${pair.refreshToken})`)?.familyId).toBe('fam-1');
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('access token sin rid (anterior a HU-104): abre una sesión nueva', async () => {
    const { users, switchMode, refreshStore } = setup();
    const user = users.add('d@panter.test', 'ACTIVE', driverRoles);
    const pair = await switchMode(
      { userId: user.id, roles: driverRoles, activeMode: 'passenger' },
      { mode: 'driver' },
    );
    expect(refreshStore.records.get(`sha(${pair.refreshToken})`)?.familyId).toBe('fam-1');
    expect(refreshStore.records.size).toBe(1);
  });

  it('cuenta suspendida → ACCOUNT_SUSPENDED', async () => {
    const { users, switchMode } = setup();
    const user = users.add('s@panter.test', 'SUSPENDED', driverRoles);
    const err = await errorOf(
      switchMode(
        { userId: user.id, roles: driverRoles, activeMode: 'passenger' },
        { mode: 'driver' },
      ),
    );
    expect(err.code).toBe(ApiErrorCode.ACCOUNT_SUSPENDED);
  });

  it('usa Date.now por defecto', async () => {
    const users = new MemoryUserRepository();
    const refreshStore = new MemoryRefreshStore();
    const codec = fakeCodec();
    const issueSession = makeIssueSession({ signer: fakeSigner, refreshStore, codec });
    const user = users.add('d@panter.test', 'ACTIVE', driverRoles);
    const first = await issueSession(user, ActiveMode.PASSENGER);
    const switchMode = makeSwitchMode({
      users,
      activeTrips: noActiveTrips,
      driverAvailability: { setUnavailable: async () => {} },
      driverEligibility: { canUseDriverMode: async () => true },
      refreshStore,
      issueSession,
    });
    const pair = await switchMode(
      {
        userId: user.id,
        roles: driverRoles,
        activeMode: 'passenger',
        refreshId: claimsOf(first.accessToken).refreshId,
      },
      { mode: 'driver' },
    );
    expect(pair.user.activeMode).toBe('driver');
  });
});
