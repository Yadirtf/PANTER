'use client';

import type { AdminUser, AdminUsersResponse, StaffRole } from '@panter/contracts';
import { useState } from 'react';
import { LOGIN_PATH } from '@/features/navigation/role-home';
import { toApiError } from '@/shared/api/errors';
import { fetchUsersPage, grantRole, revokeRole } from '../api/admin-client';
import { adminErrorMessage, requiresLogin } from '../lib/messages';
import {
  ADMIN_USERS_PATH,
  appendPage,
  canRevoke,
  grantableRoles,
  grantDescription,
  replaceUser,
  ROLE_LABEL,
  STATUS_LABEL,
  type UsersListState,
} from '../lib/users';

interface PendingChange {
  kind: 'grant' | 'revoke';
  user: AdminUser;
  role: StaffRole;
}

const smallButton =
  'rounded-md border px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60';

function confirmText(change: PendingChange): string {
  const role = ROLE_LABEL[change.role];
  return change.kind === 'grant'
    ? `¿Otorgar el rol ${role} a ${change.user.email}?`
    : `¿Retirar el rol ${role} a ${change.user.email}?`;
}

/** Tabla de usuarios con búsqueda, "Cargar más" y gestión de roles de personal (HU-108). */
export function AdminUsersManager({
  query,
  initial,
  currentUserId,
}: {
  query: string;
  initial: AdminUsersResponse;
  currentUserId: string;
}) {
  const [list, setList] = useState<UsersListState>(initial);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function fail(failure: unknown) {
    const code = toApiError(failure).code;
    if (requiresLogin(code)) {
      window.location.assign(`${LOGIN_PATH}?next=${encodeURIComponent(ADMIN_USERS_PATH)}`);
      return;
    }
    setError(adminErrorMessage(code));
  }

  async function loadMore() {
    if (!list.nextCursor) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const page = await fetchUsersPage({ q: query, cursor: list.nextCursor });
      setList((current) => appendPage(current, page));
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated =
        pending.kind === 'grant'
          ? await grantRole(pending.user.id, pending.role)
          : await revokeRole(pending.user.id, pending.role);
      setList((current) => replaceUser(current, updated));
      setNotice(
        pending.kind === 'grant'
          ? `Se otorgó el rol ${ROLE_LABEL[pending.role]} a ${updated.email}.`
          : `Se retiró el rol ${ROLE_LABEL[pending.role]} a ${updated.email}.`,
      );
    } catch (failure) {
      fail(failure);
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form action={ADMIN_USERS_PATH} method="get" role="search" className="flex flex-wrap gap-3">
        <label className="flex min-w-64 flex-1 flex-col gap-1">
          <span className="text-sm font-medium text-stone-700">Buscar por correo</span>
          <input
            type="search"
            name="q"
            defaultValue={query}
            maxLength={254}
            placeholder="nombre@correo.com"
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="self-end rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"
        >
          Buscar
        </button>
      </form>

      <div aria-live="polite" className="min-h-6">
        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : notice ? (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>
        ) : null}
      </div>

      {pending ? (
        <div
          role="alertdialog"
          aria-labelledby="confirmar-rol"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4"
        >
          <p id="confirmar-rol" className="font-medium text-stone-900">
            {confirmText(pending)}
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={confirm}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {busy ? 'Guardando…' : 'Confirmar'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPending(null)}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {list.items.length === 0 ? (
        <p className="text-stone-600">
          {query ? `No hay usuarios con un correo que contenga “${query}”.` : 'No hay usuarios.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-stone-600">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Correo
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Nombre
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Estado
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Roles
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Otorgar
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {list.items.map((user) => (
                <tr key={user.id} className="align-top">
                  <td className="px-4 py-3 font-medium break-all text-stone-900">{user.email}</td>
                  <td className="px-4 py-3 text-stone-700">{user.fullName ?? '—'}</td>
                  <td className="px-4 py-3 text-stone-700">{STATUS_LABEL[user.status]}</td>
                  <td className="px-4 py-3">
                    <ul className="flex flex-col gap-2">
                      {user.roles.map((grant) => (
                        <li key={grant.role} className="flex flex-col gap-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-stone-900">
                              {ROLE_LABEL[grant.role]}
                            </span>
                            {canRevoke(currentUserId, user, grant.role) ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  setPending({
                                    kind: 'revoke',
                                    user,
                                    role: grant.role as StaffRole,
                                  })
                                }
                                className={`${smallButton} border-red-300 text-red-800 hover:bg-red-50`}
                              >
                                Retirar
                              </button>
                            ) : null}
                          </span>
                          <span className="text-xs text-stone-500">{grantDescription(grant)}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {grantableRoles(user).map((role) => (
                        <button
                          key={role}
                          type="button"
                          disabled={busy}
                          onClick={() => setPending({ kind: 'grant', user, role })}
                          className={`${smallButton} border-emerald-300 text-emerald-800 hover:bg-emerald-50`}
                        >
                          {ROLE_LABEL[role]}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.nextCursor ? (
        <button
          type="button"
          disabled={busy}
          onClick={loadMore}
          className="self-center rounded-lg border border-stone-300 px-4 py-2 font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
        >
          {busy ? 'Cargando…' : 'Cargar más'}
        </button>
      ) : null}
    </div>
  );
}
