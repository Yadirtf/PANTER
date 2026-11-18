'use client';

import { PRIVACY_POLICY_VERSION } from '@panter/contracts';
import { useState } from 'react';
import { LOGIN_PATH } from '@/features/navigation/role-home';
import { toApiError } from '@/shared/api/errors';
import { acceptConsent, logout } from '../api/session-client';
import { consentFailureAction } from '../lib/consent';

/** "Acepto" registra el consentimiento; "No acepto" cierra la sesión (HU-109). */
export function ConsentForm({ next }: { next?: string }) {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onAccept() {
    setBusy('accept');
    setError(null);
    try {
      const { redirectTo } = await acceptConsent({
        version: PRIVACY_POLICY_VERSION,
        accepted: true,
        next,
      });
      window.location.assign(redirectTo);
    } catch (failure) {
      const action = consentFailureAction(toApiError(failure).code, window.location.href);
      if (action.kind === 'navigate') {
        window.location.replace(action.to);
        return;
      }
      setError(action.message);
      setBusy(null);
    }
  }

  async function onDecline() {
    setBusy('decline');
    let target: string = LOGIN_PATH;
    try {
      target = (await logout()).redirectTo;
    } catch {
      // Aunque falle la red, se lleva al login; el middleware valida la sesión de nuevo.
    }
    window.location.assign(target);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-stone-700">
        Para usar los paneles de PANTER necesitamos tu autorización para tratar tus datos personales
        según este aviso. Si no aceptas, cerraremos tu sesión.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onAccept}
          disabled={busy !== null}
          className="rounded-lg bg-emerald-700 px-6 py-3 font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === 'accept' ? 'Guardando…' : 'Acepto'}
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={busy !== null}
          className="rounded-lg border border-stone-300 px-6 py-3 font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === 'decline' ? 'Cerrando sesión…' : 'No acepto'}
        </button>
      </div>
      <div aria-live="polite" className="min-h-6">
        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
