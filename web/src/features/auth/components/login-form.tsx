'use client';

import { EmailSchema, OTP_LENGTH, OtpCodeSchema } from '@panter/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { toApiError } from '@/shared/api/errors';
import { requestCode, verifyCode } from '../api/session-client';
import { loginErrorMessage, requiresNewCode } from '../lib/messages';

type Step = 'email' | 'code';

const inputClass =
  'w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-lg text-stone-900 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 focus:outline-none';
const primaryButton =
  'w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60';
const linkButton =
  'text-sm font-medium text-emerald-800 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-stone-400 disabled:no-underline';

/** Segundos que faltan para poder reenviar el código; se actualiza cada segundo. */
function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [until]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

/** Login de personal en dos pasos: correo y código OTP de 6 dígitos (HU-107). */
export function LoginForm({ next }: { next?: string }) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const resendIn = useCountdown(resendAt);

  async function sendCode(target: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestCode(target);
      setResendAt(Date.now() + result.resendAfterSeconds * 1000);
      return true;
    } catch (failure) {
      setError(loginErrorMessage(toApiError(failure).code));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = EmailSchema.safeParse(email);
    if (!parsed.success) {
      setError('Escribe un correo válido, por ejemplo nombre@correo.com.');
      return;
    }
    setEmail(parsed.data);
    if (await sendCode(parsed.data)) {
      setCode('');
      setStep('code');
    }
  }

  async function onSubmitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!OtpCodeSchema.safeParse(code).success) {
      setError(`El código tiene ${OTP_LENGTH} números.`);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { redirectTo } = await verifyCode({ email, code, next });
      // Navegación completa: el middleware lee las cookies recién guardadas.
      window.location.assign(redirectTo);
    } catch (failure) {
      const apiError = toApiError(failure);
      setError(loginErrorMessage(apiError.code));
      if (requiresNewCode(apiError.code)) {
        setCode('');
        setResendAt(null);
      }
      setBusy(false);
    }
  }

  async function onResend() {
    if (await sendCode(email)) {
      setCode('');
      setNotice(`Te enviamos un código nuevo a ${email}.`);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
      <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase">
        Acceso de personal
      </p>
      <h1 className="mt-2 text-3xl font-bold text-stone-900">Iniciar sesión</h1>

      {step === 'email' ? (
        <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmitEmail} noValidate>
          <label className="flex flex-col gap-2">
            <span className="font-medium text-stone-700">Correo electrónico</span>
            <input
              className={inputClass}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              autoFocus
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <p className="text-sm text-stone-500">
            Te enviaremos un código de {OTP_LENGTH} números para entrar.
          </p>
          <button className={primaryButton} type="submit" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar código'}
          </button>
        </form>
      ) : (
        <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmitCode} noValidate>
          <p className="text-stone-600">
            Escribe el código que enviamos a <strong className="text-stone-900">{email}</strong>. Si
            no lo ves, revisa la carpeta de spam o Promociones.
          </p>
          <label className="flex flex-col gap-2">
            <span className="font-medium text-stone-700">Código de {OTP_LENGTH} números</span>
            <input
              className={`${inputClass} text-center font-mono tracking-[0.5em]`}
              type="text"
              name="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern={`\\d{${OTP_LENGTH}}`}
              maxLength={OTP_LENGTH}
              autoFocus
              required
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))
              }
            />
          </label>
          <button className={primaryButton} type="submit" disabled={busy}>
            {busy ? 'Verificando…' : 'Entrar'}
          </button>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              className={linkButton}
              type="button"
              disabled={busy || resendIn > 0}
              onClick={onResend}
            >
              {resendIn > 0 ? `Reenviar código en ${resendIn} s` : 'Reenviar código'}
            </button>
            <button
              className={linkButton}
              type="button"
              disabled={busy}
              onClick={() => {
                setStep('email');
                setError(null);
                setNotice(null);
              }}
            >
              Cambiar correo
            </button>
          </div>
        </form>
      )}

      <div aria-live="polite" className="mt-4 min-h-6">
        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : notice ? (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>
        ) : null}
      </div>
    </div>
  );
}
