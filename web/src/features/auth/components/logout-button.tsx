'use client';

import { useState } from 'react';
import { LOGIN_PATH } from '@/features/navigation/role-home';
import { logout } from '../api/session-client';

/** Cierra la sesión: revoca el refresh token en la API y borra las cookies (HU-107). */
export function LogoutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    let target: string = LOGIN_PATH;
    try {
      target = (await logout()).redirectTo;
    } catch {
      // Aunque falle la red, se lleva al login; el middleware valida la sesión de nuevo.
    }
    window.location.assign(target);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        className ??
        'rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60'
      }
    >
      {busy ? 'Cerrando…' : 'Cerrar sesión'}
    </button>
  );
}
