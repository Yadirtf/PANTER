import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminUsersView } from '@/features/admin/components/admin-users-view';
import { ADMIN_USERS_PATH } from '@/features/admin/lib/users';
import { adminApi } from '@/features/admin/server/deps';
import { loadAdminUsers } from '@/features/admin/server/load-admin-users';
import { consentPathFor } from '@/features/auth/server/consent-gate';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/features/auth/server/cookies';
import { readSessionClaims } from '@/features/auth/server/current-session';

export const metadata: Metadata = { title: 'Usuarios y roles', robots: { index: false } };

/** /admin/usuarios (HU-108). middleware.ts ya exige ADMIN; la API lo vuelve a comprobar. */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q } = await searchParams;
  const query = typeof q === 'string' ? q.trim().slice(0, 254) : '';
  const jar = await cookies();
  const load = await loadAdminUsers(
    adminApi,
    { accessToken: jar.get(ACCESS_COOKIE)?.value, refreshToken: jar.get(REFRESH_COOKIE)?.value },
    query,
  );
  const next = query ? `${ADMIN_USERS_PATH}?q=${encodeURIComponent(query)}` : ADMIN_USERS_PATH;
  if (load.kind === 'renew') redirect(`/api/session/refresh?next=${encodeURIComponent(next)}`);
  if (load.kind === 'consent') redirect(consentPathFor(next));
  const claims = await readSessionClaims();
  return <AdminUsersView query={query} load={load} currentUserId={claims?.sub ?? ''} />;
}
