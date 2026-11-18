import type { AdminUsersLoad } from '../server/load-admin-users';
import { adminErrorMessage } from '../lib/messages';
import { AdminUsersManager } from './admin-users-manager';

/** Contenido de /admin/usuarios según el resultado de la primera carga (Server Component). */
export function AdminUsersView({
  query,
  load,
  currentUserId,
}: {
  query: string;
  load: Exclude<AdminUsersLoad, { kind: 'renew' }>;
  currentUserId: string;
}) {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase">
          Panel administrativo
        </p>
        <h1 className="text-3xl font-bold text-stone-900">Usuarios y roles</h1>
        <p className="text-stone-600">
          Busca a una persona por su correo y otórgale o retírale los roles de Administrador,
          Despacho u Operador turístico. Cada cambio queda registrado con quién lo hizo y cuándo.
        </p>
      </div>
      {load.kind === 'ok' ? (
        <AdminUsersManager
          key={query}
          query={query}
          initial={load.data}
          currentUserId={currentUserId}
        />
      ) : (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-800">
          {adminErrorMessage(load.code)}
        </p>
      )}
    </main>
  );
}
