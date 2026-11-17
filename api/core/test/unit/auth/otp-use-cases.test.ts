import {
  ApiErrorCode,
  OTP_MAX_CODES_PER_WINDOW,
  OTP_MAX_VERIFY_ATTEMPTS,
  OTP_TTL_SECONDS,
  OTP_WINDOW_SECONDS,
  OtpRequestResponseSchema,
} from '@panter/contracts';
import { describe, expect, it, vi } from 'vitest';
import { makeRequestOtp, OTP_SENT } from '../../../src/modules/auth/application/request-otp';
import { makeVerifyOtp } from '../../../src/modules/auth/application/verify-otp';
import { AppError } from '../../../src/shared/errors/app-error';
import {
  captureDelivery,
  fakeHasher,
  manualClock,
  MemoryOtpStore,
  MemoryUserRepository,
} from '../../support/auth-fakes';

const EMAIL = 'ana@panter.test';

/** Aleatoriedad determinista: códigos 100001, 100002, … (siempre distintos entre sí). */
function counterRandom() {
  let n = 100_000;
  return (array: Uint32Array) => {
    array[0] = ++n;
    return array;
  };
}

function setup() {
  const store = new MemoryOtpStore();
  const users = new MemoryUserRepository();
  const clock = manualClock();
  const mail = captureDelivery();
  const request = makeRequestOtp({
    store,
    hasher: fakeHasher,
    deliver: mail.deliver,
    clock: clock.now,
    random: counterRandom(),
  });
  const verify = makeVerifyOtp({ store, hasher: fakeHasher, users, clock: clock.now });
  return { store, users, clock, mail, request, verify };
}

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

describe('pedir código (POST /auth/otp/request)', () => {
  it('responde el cuerpo 202 del contrato y envía un código de 6 dígitos', async () => {
    const { request, mail } = setup();
    const res = await request({ email: EMAIL });
    expect(res).toEqual(OTP_SENT);
    expect(OtpRequestResponseSchema.parse(res)).toEqual(res);
    expect(mail.sent).toEqual([{ email: EMAIL, code: expect.stringMatching(/^\d{6}$/) }]);
  });

  it('guarda solo el HMAC del código, con clave derivada del correo y vigencia de 5 min', async () => {
    const { request, store, mail, clock } = setup();
    await request({ email: EMAIL });
    const code = mail.lastCode(EMAIL)!;
    expect([...store.codes.entries()]).toEqual([
      [
        `h(email:${EMAIL})`,
        {
          hash: `h(otp:${EMAIL}:${code})`,
          attempts: 0,
          expiresAt: clock.now() + OTP_TTL_SECONDS * 1000,
        },
      ],
    ]);
  });

  it('la respuesta es la misma exista o no la cuenta, y no consulta usuarios', async () => {
    const { request, users } = setup();
    users.add('existe@panter.test');
    const spy = vi.spyOn(users, 'findOrCreatePassenger');
    const a = await request({ email: 'existe@panter.test' });
    const b = await request({ email: 'nuevo@panter.test' });
    expect(a).toEqual(b);
    expect(spy).not.toHaveBeenCalled();
  });

  it(`limita a ${OTP_MAX_CODES_PER_WINDOW} códigos por correo cada 15 min`, async () => {
    const { request, clock, mail } = setup();
    for (let i = 0; i < OTP_MAX_CODES_PER_WINDOW; i++) {
      await request({ email: EMAIL });
      clock.advance(60_000);
    }
    const err = await errorOf(request({ email: EMAIL }));
    expect(err.code).toBe(ApiErrorCode.OTP_RATE_LIMITED);
    expect(err.status).toBe(429);
    // La ventana empezó con el primer código: quedan 15 min - 3 min.
    expect(err.details).toEqual({ retryAfterSeconds: OTP_WINDOW_SECONDS - 180 });
    expect(mail.sent).toHaveLength(OTP_MAX_CODES_PER_WINDOW);

    // Otro correo no se ve afectado.
    await expect(request({ email: 'otra@panter.test' })).resolves.toEqual(OTP_SENT);
  });

  it('la ventana se reinicia al cumplirse los 15 min', async () => {
    const { request, clock } = setup();
    for (let i = 0; i < OTP_MAX_CODES_PER_WINDOW; i++) await request({ email: EMAIL });
    clock.advance(OTP_WINDOW_SECONDS * 1000);
    await expect(request({ email: EMAIL })).resolves.toEqual(OTP_SENT);
  });

  it('un código nuevo reemplaza al anterior y reinicia los intentos', async () => {
    const { request, verify, mail, store } = setup();
    await request({ email: EMAIL });
    const first = mail.lastCode(EMAIL)!;
    await errorOf(verify({ email: EMAIL, code: '000000' }));
    expect([...store.codes.values()][0]?.attempts).toBe(1);
    await request({ email: EMAIL });
    const second = mail.lastCode(EMAIL)!;
    expect(second).not.toBe(first);
    expect([...store.codes.values()][0]?.attempts).toBe(0);
    expect((await errorOf(verify({ email: EMAIL, code: first }))).code).toBe('OTP_INVALID');
    await expect(verify({ email: EMAIL, code: second })).resolves.toMatchObject({ email: EMAIL });
  });

  it('si el correo no sale, borra el código y responde EMAIL_DELIVERY_FAILED (503)', async () => {
    const store = new MemoryOtpStore();
    const onDeliveryFailure = vi.fn();
    const cause = new Error('brevo caído');
    const request = makeRequestOtp({
      store,
      hasher: fakeHasher,
      deliver: () => Promise.reject(cause),
      onDeliveryFailure,
    });
    const err = await errorOf(request({ email: EMAIL }));
    expect(err).toMatchObject({ code: 'EMAIL_DELIVERY_FAILED', status: 503 });
    expect(store.codes.size).toBe(0);
    expect(onDeliveryFailure).toHaveBeenCalledWith(cause);
  });

  it('usa Date.now si no se inyecta reloj', async () => {
    const store = new MemoryOtpStore();
    const before = Date.now();
    await makeRequestOtp({ store, hasher: fakeHasher, deliver: async () => {} })({ email: EMAIL });
    const record = [...store.codes.values()][0]!;
    expect(record.expiresAt).toBeGreaterThanOrEqual(before + OTP_TTL_SECONDS * 1000);
  });
});

describe('verificar código (POST /auth/otp/verify)', () => {
  it('crea la cuenta con rol PASSENGER si no existe', async () => {
    const { request, verify, mail, users } = setup();
    await request({ email: EMAIL });
    const user = await verify({ email: EMAIL, code: mail.lastCode(EMAIL)! });
    expect(user).toMatchObject({ email: EMAIL, status: 'ACTIVE', roles: ['PASSENGER'] });
    expect(users.created).toBe(1);
  });

  it('devuelve la cuenta existente sin crear otra', async () => {
    const { request, verify, mail, users } = setup();
    const existing = users.add(EMAIL, 'ACTIVE', ['PASSENGER', 'DRIVER']);
    await request({ email: EMAIL });
    await expect(verify({ email: EMAIL, code: mail.lastCode(EMAIL)! })).resolves.toEqual(existing);
    expect(users.created).toBe(0);
  });

  it('el código es de un solo uso', async () => {
    const { request, verify, mail } = setup();
    await request({ email: EMAIL });
    const code = mail.lastCode(EMAIL)!;
    await verify({ email: EMAIL, code });
    expect((await errorOf(verify({ email: EMAIL, code }))).code).toBe(ApiErrorCode.OTP_EXPIRED);
  });

  it('sin código pedido responde OTP_EXPIRED', async () => {
    const { verify } = setup();
    const err = await errorOf(verify({ email: EMAIL, code: '123456' }));
    expect(err).toMatchObject({ code: ApiErrorCode.OTP_EXPIRED, status: 400 });
  });

  it('un código vencido responde OTP_EXPIRED y se borra', async () => {
    const { request, verify, mail, clock, store } = setup();
    await request({ email: EMAIL });
    clock.advance(OTP_TTL_SECONDS * 1000);
    const err = await errorOf(verify({ email: EMAIL, code: mail.lastCode(EMAIL)! }));
    expect(err.code).toBe(ApiErrorCode.OTP_EXPIRED);
    expect(store.codes.size).toBe(0);
  });

  it('código incorrecto: OTP_INVALID con intentos restantes; al 5.º se invalida', async () => {
    const { request, verify, mail, store } = setup();
    await request({ email: EMAIL });
    const code = mail.lastCode(EMAIL)!;
    const wrong = '000000';
    for (let left = OTP_MAX_VERIFY_ATTEMPTS - 1; left > 0; left--) {
      const err = await errorOf(verify({ email: EMAIL, code: wrong }));
      expect(err).toMatchObject({ code: ApiErrorCode.OTP_INVALID, status: 400 });
      expect(err.details).toEqual({ attemptsLeft: left });
    }
    const last = await errorOf(verify({ email: EMAIL, code: wrong }));
    expect(last).toMatchObject({ code: ApiErrorCode.OTP_TOO_MANY_ATTEMPTS, status: 429 });
    expect(store.codes.size).toBe(0);
    // Ni el código correcto sirve ya.
    expect((await errorOf(verify({ email: EMAIL, code }))).code).toBe(ApiErrorCode.OTP_EXPIRED);
  });

  it('el código de un correo no sirve para otro', async () => {
    const { request, verify, mail } = setup();
    await request({ email: EMAIL });
    await request({ email: 'beto@panter.test' });
    const err = await errorOf(verify({ email: 'beto@panter.test', code: mail.lastCode(EMAIL)! }));
    expect(err.code).toBe(ApiErrorCode.OTP_INVALID);
  });

  it.each(['SUSPENDED', 'DELETED'] as const)(
    'rechaza cuentas %s con ACCOUNT_SUSPENDED',
    async (status) => {
      const { request, verify, mail, users, store } = setup();
      users.add(EMAIL, status);
      await request({ email: EMAIL });
      const err = await errorOf(verify({ email: EMAIL, code: mail.lastCode(EMAIL)! }));
      expect(err).toMatchObject({ code: ApiErrorCode.ACCOUNT_SUSPENDED, status: 403 });
      expect(store.codes.size).toBe(0);
    },
  );

  it('usa Date.now si no se inyecta reloj', async () => {
    const store = new MemoryOtpStore();
    const users = new MemoryUserRepository();
    const mail = captureDelivery();
    await makeRequestOtp({ store, hasher: fakeHasher, deliver: mail.deliver })({ email: EMAIL });
    const verify = makeVerifyOtp({ store, hasher: fakeHasher, users });
    await expect(verify({ email: EMAIL, code: mail.lastCode(EMAIL)! })).resolves.toBeDefined();
  });
});
