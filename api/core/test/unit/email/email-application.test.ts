import { describe, expect, it, vi } from 'vitest';
import { FallbackEmailSender } from '../../../src/modules/email/application/fallback-email-sender';
import {
  EmailSendError,
  type EmailMessage,
  type EmailSender,
} from '../../../src/modules/email/application/ports';
import { makeSendOtpEmail } from '../../../src/modules/email/application/send-otp-email';

/** Doble en memoria: registra los envíos o falla con el error indicado. */
class FakeSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  constructor(
    readonly name: string,
    private readonly failWith?: unknown,
  ) {}
  async send(message: EmailMessage) {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
  }
}

const message: EmailMessage = { to: 'a@panter.test', subject: 's', text: 't' };

describe('FallbackEmailSender', () => {
  it('usa solo el principal si responde bien', async () => {
    const primary = new FakeSender('brevo');
    const fallback = new FakeSender('resend');
    const sender = new FallbackEmailSender(primary, fallback);
    await sender.send(message);
    expect(primary.sent).toEqual([message]);
    expect(fallback.sent).toEqual([]);
    expect(sender.name).toBe('brevo+resend');
  });

  it('pasa al respaldo si el principal alcanza el límite diario (429)', async () => {
    const limit = new EmailSendError('brevo', 'rate_limited', 'brevo respondió 429', {
      status: 429,
    });
    const onPrimaryFailure = vi.fn();
    const fallback = new FakeSender('resend');
    await new FallbackEmailSender(new FakeSender('brevo', limit), fallback, {
      onPrimaryFailure,
    }).send(message);
    expect(fallback.sent).toEqual([message]);
    expect(onPrimaryFailure).toHaveBeenCalledWith(limit, 'brevo', 'resend');
  });

  it('pasa al respaldo ante cualquier otro fallo', async () => {
    const fallback = new FakeSender('resend');
    await new FallbackEmailSender(new FakeSender('brevo', new Error('caído')), fallback).send(
      message,
    );
    expect(fallback.sent).toHaveLength(1);
  });

  it('si fallan ambos lanza EmailSendError con los dos errores', async () => {
    const e1 = new EmailSendError('brevo', 'rate_limited', 'x');
    const e2 = new EmailSendError('resend', 'rejected', 'y');
    const sender = new FallbackEmailSender(new FakeSender('brevo', e1), new FakeSender('r', e2));
    const err = await sender.send(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect((err as EmailSendError).reason).toBe('rejected');
    expect((err as Error).cause).toEqual([e1, e2]);
  });

  it('si el respaldo lanza algo que no es EmailSendError, el motivo es network', async () => {
    const sender = new FallbackEmailSender(
      new FakeSender('a', new Error('1')),
      new FakeSender('b', new Error('2')),
    );
    await expect(sender.send(message)).rejects.toMatchObject({ reason: 'network' });
  });
});

describe('enviar OTP por correo', () => {
  function setup({ echo = false, failWith }: { echo?: boolean; failWith?: unknown } = {}) {
    const sender = new FakeSender('fake', failWith);
    const echoed: { to: string; code: string }[] = [];
    const onEchoedSendFailure = vi.fn();
    const send = makeSendOtpEmail({
      sender,
      echoLog: { echo: (entry) => echoed.push(entry) },
      shouldEcho: () => echo,
      onEchoedSendFailure,
    });
    return { send, sender, echoed, onEchoedSendFailure };
  }

  it('envía la plantilla con texto y HTML', async () => {
    const { send, sender, echoed } = setup();
    await send('a@panter.test', '123456');
    expect(sender.sent).toEqual([
      expect.objectContaining({
        to: 'a@panter.test',
        subject: 'Tu código PANTER es 123456',
        text: expect.stringContaining('123456'),
        html: expect.stringContaining('123456'),
      }),
    ]);
    expect(echoed).toEqual([]);
  });

  it('con eco activo registra el código y también envía el correo', async () => {
    const { send, sender, echoed } = setup({ echo: true });
    await send('tester@gmail.com', '000123');
    expect(echoed).toEqual([{ to: 'tester@gmail.com', code: '000123' }]);
    expect(sender.sent).toHaveLength(1);
  });

  it('sin eco, un fallo del proveedor se propaga', async () => {
    const { send } = setup({ failWith: new Error('caído') });
    await expect(send('a@panter.test', '123456')).rejects.toThrow('caído');
  });

  it('con eco, un fallo del proveedor no bloquea al tester', async () => {
    const error = new Error('caído');
    const { send, echoed, onEchoedSendFailure } = setup({ echo: true, failWith: error });
    await expect(send('tester@gmail.com', '123456')).resolves.toBeUndefined();
    expect(echoed).toHaveLength(1);
    expect(onEchoedSendFailure).toHaveBeenCalledWith(error);
  });
});
