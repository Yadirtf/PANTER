import {
  ActiveMode,
  ApiErrorCode,
  REFRESH_TOKEN_TTL_SECONDS,
  Role,
  TokenPairResponseSchema,
} from '@panter/contracts';
import { describe, expect, it, vi } from 'vitest';
import { makeRequestOtp } from '../../../src/modules/auth/application/request-otp';
import {
  makeIssueSession,
  makeLogout,
  makeRefreshSession,
  makeSignInWithOtp,
} from '../../../src/modules/auth/application/session';
import { makeVerifyOtp } from '../../../src/modules/auth/application/verify-otp';
import { AppError } from '../../../src/shared/errors/app-error';
import {
  captureDelivery,
  fakeCodec,
  fakeHasher,
  fakeSigner,
  manualClock,
  MemoryOtpStore,
  MemoryRefreshStore,
  MemoryUserRepository,
} from '../../support/auth-fakes';

const DAY = 24 * 60 * 60 * 1000;

function setup() {
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
  const onReuseDetected = vi.fn();
  const refresh = makeRefreshSession({
    refreshStore,
    codec,
    users,
    issueSession,
    clock: clock.now,
    onReuseDetected,
  });
  const logout = makeLogout({ refreshStore, codec, clock: clock.now });
  return { clock, users, refreshStore, issueSession, refresh, logout, onReuseDetected };
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  const err = await promise.then(
    () => {
      throw new Error('se esperaba un error');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return (err as AppError).code;
}

describe('emitir sesión', () => {
  it('devuelve TokenPairResponse y guarda solo el hash del refresh token', async () => {
    const { users, issueSession, refreshStore, clock } = setup();
    const user = users.add('ana@panter.test');
    const pair = await issueSession(user, ActiveMode.PASSENGER);
    expect(TokenPairResponseSchema.parse(pair)).toEqual(pair);
    expect(pair).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      refreshToken: 'rt-1',
      refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
      user: { id: user.id, roles: ['PASSENGER'], activeMode: 'passenger' },
    });
    expect([...refreshStore.records.entries()]).toEqual([
      [
        'sha(rt-1)',
        {
          userId: user.id,
          activeMode: 'passenger',
          familyId: 'fam-1',
          expiresAt: clock.now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
        },
      ],
    ]);
  });

  it('modo driver solo si la cuenta tiene el rol', async () => {
    const { users, issueSession } = setup();
    const driver = users.add('d@panter.test', 'ACTIVE', [Role.PASSENGER, Role.DRIVER]);
    const passenger = users.add('p@panter.test');
    expect((await issueSession(driver, ActiveMode.DRIVER)).user.activeMode).toBe('driver');
    expect((await issueSession(passenger, ActiveMode.DRIVER)).user.activeMode).toBe('passenger');
  });

  it('usa crypto.randomUUID y Date.now por defecto', async () => {
    const refreshStore = new MemoryRefreshStore();
    const issue = makeIssueSession({ signer: fakeSigner, refreshStore, codec: fakeCodec() });
    await issue(new MemoryUserRepository().add('a@panter.test'), ActiveMode.PASSENGER);
    const record = [...refreshStore.records.values()][0]!;
    expect(record.familyId).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe('iniciar sesión con OTP', () => {
  it('verify emite el par en modo passenger', async () => {
    const { users, issueSession } = setup();
    const store = new MemoryOtpStore();
    const mail = captureDelivery();
    await makeRequestOtp({ store, hasher: fakeHasher, deliver: mail.deliver })({
      email: 'ana@panter.test',
    });
    const signIn = makeSignInWithOtp({
      verifyOtp: makeVerifyOtp({ store, hasher: fakeHasher, users }),
      issueSession,
    });
    const pair = await signIn({
      email: 'ana@panter.test',
      code: mail.lastCode('ana@panter.test')!,
    });
    expect(pair.user).toMatchObject({ email: 'ana@panter.test', activeMode: 'passenger' });
    expect(pair.accessToken).toContain('"activeMode":"passenger"');
  });
});

describe('renovar sesión (POST /auth/refresh)', () => {
  it('rota: el anterior queda marcado y el nuevo sigue en la misma familia', async () => {
    const { users, issueSession, refresh, refreshStore } = setup();
    const user = users.add('ana@panter.test');
    const first = await issueSession(user, ActiveMode.PASSENGER);
    const second = await refresh({ refreshToken: first.refreshToken });
    expect(second.refreshToken).toBe('rt-2');
    expect(refreshStore.records.get('sha(rt-1)')).toMatchObject({ rotated: true });
    expect(refreshStore.records.get('sha(rt-2)')).toMatchObject({
      familyId: 'fam-1',
      userId: user.id,
    });
    expect(refreshStore.records.get('sha(rt-2)')?.rotated).toBeUndefined();
    // Y el nuevo también rota.
    await expect(refresh({ refreshToken: second.refreshToken })).resolves.toMatchObject({
      refreshToken: 'rt-3',
    });
  });

  it('reutilizar un token ya usado revoca la familia completa', async () => {
    const { users, issueSession, refresh, refreshStore, onReuseDetected } = setup();
    const user = users.add('ana@panter.test');
    const first = await issueSession(user, ActiveMode.PASSENGER);
    const second = await refresh({ refreshToken: first.refreshToken });
    expect(await errorCode(refresh({ refreshToken: first.refreshToken }))).toBe(
      ApiErrorCode.REFRESH_TOKEN_INVALID,
    );
    expect(refreshStore.revoked.has('fam-1')).toBe(true);
    expect(onReuseDetected).toHaveBeenCalledWith({ userId: user.id, familyId: 'fam-1' });
    // El token "legítimo" más reciente también deja de servir.
    expect(await errorCode(refresh({ refreshToken: second.refreshToken }))).toBe(
      ApiErrorCode.REFRESH_TOKEN_INVALID,
    );
  });

  it('otras sesiones del mismo usuario no se ven afectadas', async () => {
    const { users, issueSession, refresh } = setup();
    const user = users.add('ana@panter.test');
    const phone = await issueSession(user, ActiveMode.PASSENGER);
    const web = await issueSession(user, ActiveMode.PASSENGER);
    await refresh({ refreshToken: phone.refreshToken });
    await errorCode(refresh({ refreshToken: phone.refreshToken }));
    await expect(refresh({ refreshToken: web.refreshToken })).resolves.toBeDefined();
  });

  it('desconocido o vencido → REFRESH_TOKEN_INVALID', async () => {
    const { users, issueSession, refresh, clock } = setup();
    expect(await errorCode(refresh({ refreshToken: 'no-existe' }))).toBe('REFRESH_TOKEN_INVALID');
    const pair = await issueSession(users.add('a@panter.test'), ActiveMode.PASSENGER);
    clock.advance(30 * DAY);
    expect(await errorCode(refresh({ refreshToken: pair.refreshToken }))).toBe(
      'REFRESH_TOKEN_INVALID',
    );
  });

  it('usa los roles actuales y conserva el modo de la sesión', async () => {
    const { users, issueSession, refresh } = setup();
    const user = users.add('d@panter.test', 'ACTIVE', [Role.PASSENGER, Role.DRIVER]);
    const pair = await issueSession(user, ActiveMode.DRIVER);
    user.roles = [Role.PASSENGER, Role.DRIVER, Role.ADMIN];
    const next = await refresh({ refreshToken: pair.refreshToken });
    expect(next.user).toMatchObject({
      roles: ['PASSENGER', 'DRIVER', 'ADMIN'],
      activeMode: 'driver',
    });
    // Si pierde el rol DRIVER, vuelve a pasajero.
    user.roles = [Role.PASSENGER];
    const after = await refresh({ refreshToken: next.refreshToken });
    expect(after.user.activeMode).toBe('passenger');
  });

  it('cuenta suspendida → ACCOUNT_SUSPENDED y familia revocada', async () => {
    const { users, issueSession, refresh, refreshStore } = setup();
    const user = users.add('a@panter.test');
    const pair = await issueSession(user, ActiveMode.PASSENGER);
    user.status = 'SUSPENDED';
    expect(await errorCode(refresh({ refreshToken: pair.refreshToken }))).toBe(
      ApiErrorCode.ACCOUNT_SUSPENDED,
    );
    expect(refreshStore.revoked.has('fam-1')).toBe(true);
  });

  it('cuenta inexistente → REFRESH_TOKEN_INVALID', async () => {
    const { users, issueSession, refresh } = setup();
    const user = users.add('a@panter.test');
    const pair = await issueSession(user, ActiveMode.PASSENGER);
    users.users.delete(user.id);
    expect(await errorCode(refresh({ refreshToken: pair.refreshToken }))).toBe(
      'REFRESH_TOKEN_INVALID',
    );
  });

  it('usa Date.now por defecto', async () => {
    const refreshStore = new MemoryRefreshStore();
    const codec = fakeCodec();
    const users = new MemoryUserRepository();
    const issueSession = makeIssueSession({ signer: fakeSigner, refreshStore, codec });
    const pair = await issueSession(users.add('a@panter.test'), ActiveMode.PASSENGER);
    const refresh = makeRefreshSession({ refreshStore, codec, users, issueSession });
    await expect(refresh({ refreshToken: pair.refreshToken })).resolves.toBeDefined();
    await errorCode(refresh({ refreshToken: pair.refreshToken }));
    expect(refreshStore.revoked.size).toBe(1);
  });
});

describe('cerrar sesión (POST /auth/logout)', () => {
  it('borra el token y revoca la familia', async () => {
    const { users, issueSession, logout, refresh, refreshStore } = setup();
    const pair = await issueSession(users.add('a@panter.test'), ActiveMode.PASSENGER);
    await logout({ refreshToken: pair.refreshToken });
    expect(refreshStore.records.has('sha(rt-1)')).toBe(false);
    expect(refreshStore.revoked.has('fam-1')).toBe(true);
    expect(await errorCode(refresh({ refreshToken: pair.refreshToken }))).toBe(
      'REFRESH_TOKEN_INVALID',
    );
  });

  it('un token ya rotado no puede renovarse tras el logout del vigente', async () => {
    const { users, issueSession, logout, refresh } = setup();
    const first = await issueSession(users.add('a@panter.test'), ActiveMode.PASSENGER);
    const second = await refresh({ refreshToken: first.refreshToken });
    await logout({ refreshToken: second.refreshToken });
    expect(await errorCode(refresh({ refreshToken: second.refreshToken }))).toBe(
      'REFRESH_TOKEN_INVALID',
    );
  });

  it('es idempotente con tokens desconocidos', async () => {
    const { logout, refreshStore } = setup();
    await expect(logout({ refreshToken: 'no-existe' })).resolves.toBeUndefined();
    expect(refreshStore.revoked.size).toBe(0);
  });

  it('usa Date.now por defecto', async () => {
    const refreshStore = new MemoryRefreshStore();
    const codec = fakeCodec();
    const pair = await makeIssueSession({ signer: fakeSigner, refreshStore, codec })(
      new MemoryUserRepository().add('a@panter.test'),
      ActiveMode.PASSENGER,
    );
    await makeLogout({ refreshStore, codec })({ refreshToken: pair.refreshToken });
    expect([...refreshStore.revoked.values()][0]).toBeGreaterThan(Date.now());
  });
});
