import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { MissingConfigError } from '../src/composition/config';
import { buildEmailSender, buildSendOtpEmail, type EmailEnv } from '../src/composition/email';
import { FallbackEmailSender } from '../src/modules/email/application/fallback-email-sender';
import { EmailSendError } from '../src/modules/email/application/ports';
import {
  BREVO_API_URL,
  BrevoEmailSender,
} from '../src/modules/email/infrastructure/brevo-email-sender';
import { createConsoleOtpEchoLog } from '../src/modules/email/infrastructure/console-otp-echo-log';
import type { FetchLike } from '../src/modules/email/infrastructure/provider-http';
import {
  RESEND_API_URL,
  ResendEmailSender,
} from '../src/modules/email/infrastructure/resend-email-sender';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal: AbortSignal | null | undefined;
}

/** fetch simulado: nunca sale a Internet. Responde según `responder` y registra las llamadas. */
function fakeFetch(responder: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      signal: init.signal,
    };
    calls.push(call);
    return responder(call);
  };
  return { fn, calls };
}

const message = {
  to: 'pasajero@panter.test',
  subject: 'Tu código PANTER es 123456',
  text: 'texto',
  html: '<p>html</p>',
};

describe('BrevoEmailSender', () => {
  it('llama a la API transaccional con el remitente verificado', async () => {
    const { fn, calls } = fakeFetch(() => Response.json({ messageId: 'm1' }, { status: 201 }));
    const sender = new BrevoEmailSender({
      apiKey: 'xkeysib-test',
      fromEmail: 'panter@gmail.com',
      fromName: 'PANTER',
      fetch: fn,
    });
    await sender.send(message);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(BREVO_API_URL);
    expect(calls[0]?.headers['api-key']).toBe('xkeysib-test');
    expect(calls[0]?.headers['content-type']).toBe('application/json');
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.body).toEqual({
      sender: { email: 'panter@gmail.com', name: 'PANTER' },
      to: [{ email: 'pasajero@panter.test' }],
      subject: 'Tu código PANTER es 123456',
      textContent: 'texto',
      htmlContent: '<p>html</p>',
    });
  });

  it('omite htmlContent si no hay HTML', async () => {
    const { fn, calls } = fakeFetch(() => new Response(null, { status: 201 }));
    await new BrevoEmailSender({ apiKey: 'k', fromEmail: 'f@x.co', fromName: 'P', fetch: fn }).send(
      { to: 'a@b.co', subject: 's', text: 't' },
    );
    expect(calls[0]?.body).not.toHaveProperty('htmlContent');
  });

  it.each([
    [429, 'rate_limited'],
    [401, 'rejected'],
    [400, 'rejected'],
    [503, 'unavailable'],
  ] as const)('traduce %i a %s', async (status, reason) => {
    const { fn } = fakeFetch(() =>
      Response.json({ code: 'too_many_requests', message: 'pasajero@panter.test' }, { status }),
    );
    const err = await new BrevoEmailSender({
      apiKey: 'k',
      fromEmail: 'f',
      fromName: 'P',
      fetch: fn,
    })
      .send(message)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err).toMatchObject({ provider: 'brevo', reason, status });
    // El mensaje lleva el código del proveedor, nunca su texto (puede traer el destinatario).
    expect((err as Error).message).not.toContain('pasajero@panter.test');
    expect((err as Error).message).toContain('too_many_requests');
  });

  it('un error de red es reason=network', async () => {
    const fn: FetchLike = () => Promise.reject(new TypeError('fetch failed'));
    await expect(
      new BrevoEmailSender({ apiKey: 'k', fromEmail: 'f', fromName: 'P', fetch: fn }).send(message),
    ).rejects.toMatchObject({ reason: 'network' });
  });

  it('sin fetch inyectado usa el fetch global (simulado aquí)', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(null, { status: 201 }));
    await new BrevoEmailSender({ apiKey: 'k', fromEmail: 'f', fromName: 'P' }).send(message);
    await new ResendEmailSender({ apiKey: 'k', fromEmail: 'f', fromName: 'P' }).send(message);
    expect(spy.mock.calls.map(([url]) => url)).toEqual([BREVO_API_URL, RESEND_API_URL]);
    spy.mockRestore();
  });

  it('si el cuerpo del error no se puede leer, igual se traduce el estado', async () => {
    const fn: FetchLike = async () =>
      ({ ok: false, status: 500, text: () => Promise.reject(new Error('x')) }) as Response;
    await expect(
      new BrevoEmailSender({ apiKey: 'k', fromEmail: 'f', fromName: 'P', fetch: fn }).send(message),
    ).rejects.toMatchObject({ reason: 'unavailable', status: 500 });
  });

  it('respuestas de error sin JSON también se traducen', async () => {
    const { fn } = fakeFetch(() => new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(
      new BrevoEmailSender({ apiKey: 'k', fromEmail: 'f', fromName: 'P', fetch: fn }).send(message),
    ).rejects.toThrow(/brevo respondió 502$/);
  });
});

describe('ResendEmailSender', () => {
  it('llama a POST /emails con Bearer y remitente "Nombre <correo>"', async () => {
    const { fn, calls } = fakeFetch(() => Response.json({ id: 'r1' }));
    await new ResendEmailSender({
      apiKey: 're_test',
      fromEmail: 'no-reply@mail.panter.co',
      fromName: 'PANTER <x>',
      fetch: fn,
    }).send(message);
    expect(calls[0]?.url).toBe(RESEND_API_URL);
    expect(calls[0]?.headers.authorization).toBe('Bearer re_test');
    expect(calls[0]?.body).toEqual({
      from: 'PANTER x <no-reply@mail.panter.co>',
      to: ['pasajero@panter.test'],
      subject: 'Tu código PANTER es 123456',
      text: 'texto',
      html: '<p>html</p>',
    });
  });

  it('el 429 de cuota diaria es rate_limited', async () => {
    const { fn } = fakeFetch(() =>
      Response.json({ name: 'daily_quota_exceeded', message: 'x' }, { status: 429 }),
    );
    await expect(
      new ResendEmailSender({ apiKey: 'k', fromEmail: 'f', fromName: 'P', fetch: fn }).send({
        to: 'a@b.co',
        subject: 's',
        text: 't',
      }),
    ).rejects.toMatchObject({ provider: 'resend', reason: 'rate_limited' });
  });
});

describe('selección de proveedor (composition)', () => {
  const base: EmailEnv = {
    ENVIRONMENT: 'development',
    EMAIL_FROM: 'panter@gmail.com',
    EMAIL_FROM_NAME: 'PANTER',
    BREVO_API_KEY: 'brevo-key',
  };

  it('las vars de wrangler.jsonc existen con brevo por defecto', () => {
    expect(env.EMAIL_PROVIDER).toBe('brevo');
    expect(env.EMAIL_FROM_NAME).toBe('PANTER');
    expect(env.OTP_DEV_ECHO).toBe('false');
  });

  it('brevo por defecto, sin respaldo si falta RESEND_API_KEY', () => {
    expect(buildEmailSender(base)).toBeInstanceOf(BrevoEmailSender);
    expect(buildEmailSender({ ...base, EMAIL_PROVIDER: 'Brevo' })).toBeInstanceOf(BrevoEmailSender);
  });

  it('con las dos llaves, brevo principal y resend de respaldo', async () => {
    const sender = buildEmailSender({ ...base, RESEND_API_KEY: 'resend-key' });
    expect(sender).toBeInstanceOf(FallbackEmailSender);
    expect(sender.name).toBe('brevo+resend');
  });

  it('EMAIL_PROVIDER=resend invierte el orden', () => {
    const sender = buildEmailSender({
      ...base,
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'resend-key',
    });
    expect(sender.name).toBe('resend+brevo');
    expect(
      buildEmailSender({
        ...base,
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 'k',
        BREVO_API_KEY: '',
      }),
    ).toBeInstanceOf(ResendEmailSender);
  });

  it('pasa a Resend cuando Brevo agota la cuota (429), con fetch simulado', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fn, calls } = fakeFetch(({ url }) =>
      url === BREVO_API_URL
        ? Response.json({ code: 'too_many_requests' }, { status: 429 })
        : Response.json({ id: 'r1' }),
    );
    await buildEmailSender({ ...base, RESEND_API_KEY: 'resend-key' }, fn).send(message);
    expect(calls.map((c) => c.url)).toEqual([BREVO_API_URL, RESEND_API_URL]);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'email_fallback' }));
    warn.mockRestore();
  });

  it('errores claros si falta configuración', () => {
    expect(() => buildEmailSender({ ...base, BREVO_API_KEY: undefined })).toThrow(
      MissingConfigError,
    );
    expect(() => buildEmailSender({ ...base, BREVO_API_KEY: ' ' })).toThrow(/BREVO_API_KEY/);
    expect(() => buildEmailSender({ ...base, EMAIL_FROM: '' })).toThrow(/var EMAIL_FROM/);
    expect(() => buildEmailSender({ ...base, EMAIL_PROVIDER: 'resend' })).toThrow(
      /secreto RESEND_API_KEY.*wrangler secret put/,
    );
    expect(() => buildEmailSender({ ...base, EMAIL_PROVIDER: 'sendgrid' })).toThrow(
      /EMAIL_PROVIDER inválido/,
    );
  });

  it('EMAIL_FROM_NAME vacío usa "PANTER"', async () => {
    const { fn, calls } = fakeFetch(() => new Response(null, { status: 201 }));
    await buildEmailSender({ ...base, EMAIL_FROM_NAME: '' }, fn).send(message);
    expect(calls[0]?.body.sender).toEqual({ email: 'panter@gmail.com', name: 'PANTER' });
  });
});

describe('OTP_DEV_ECHO de punta a punta (composition)', () => {
  const allowlisted: Omit<EmailEnv, 'ENVIRONMENT'> = {
    EMAIL_FROM: 'panter@gmail.com',
    BREVO_API_KEY: 'k',
    OTP_DEV_ECHO: 'true',
    OTP_DEV_ECHO_ALLOWLIST: 'tester@gmail.com',
  };

  async function run(environment: string, to = 'tester@gmail.com') {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { fn, calls } = fakeFetch(() => new Response(null, { status: 201 }));
    await buildSendOtpEmail({ ...allowlisted, ENVIRONMENT: environment }, fn)(to, '482913');
    const echoes = log.mock.calls.filter(([entry]) => JSON.stringify(entry).includes('482913'));
    log.mockRestore();
    return { echoes, calls };
  }

  it('en staging registra el código en logs estructurados y envía el correo', async () => {
    const { echoes, calls } = await run('staging');
    expect(echoes).toEqual([[{ event: 'otp_dev_echo', to: 'tester@gmail.com', code: '482913' }]]);
    expect(calls).toHaveLength(1);
  });

  it('en staging no registra correos fuera de la lista blanca', async () => {
    const { echoes, calls } = await run('staging', 'otro@gmail.com');
    expect(echoes).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('en production es imposible aunque OTP_DEV_ECHO="true"', async () => {
    const { echoes, calls } = await run('production');
    expect(echoes).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('con eco, si el proveedor falla se avisa en logs y no se lanza', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fn } = fakeFetch(() => new Response(null, { status: 500 }));
    await buildSendOtpEmail({ ...allowlisted, ENVIRONMENT: 'staging' }, fn)(
      'tester@gmail.com',
      '111111',
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'otp_email_failed_echoed' }),
    );
    log.mockRestore();
    warn.mockRestore();
  });

  it('el log de eco usa console.log por defecto', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    createConsoleOtpEchoLog().echo({ to: 'a@b.co', code: '1' });
    expect(log).toHaveBeenCalledWith({ event: 'otp_dev_echo', to: 'a@b.co', code: '1' });
    log.mockRestore();
  });
});
