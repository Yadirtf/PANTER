import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { AdminDashboardPlaceholder } from '@/features/admin/components/admin-dashboard-placeholder';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/features/auth/server/cookies';
import { pendingCountLabel } from '@/features/drivers/lib/drivers';
import { driversApi } from '@/features/drivers/server/deps';
import { loadPendingCount } from '@/features/drivers/server/load-drivers';

export const metadata: Metadata = { title: 'Administración', robots: { index: false } };

export default async function AdminPage() {
  const jar = await cookies();
  // Número de solicitudes pendientes (HU-204). Si falla, el enlace aparece sin número.
  const pending = await loadPendingCount(driversApi, {
    accessToken: jar.get(ACCESS_COOKIE)?.value,
    refreshToken: jar.get(REFRESH_COOKIE)?.value,
  });
  return <AdminDashboardPlaceholder pendingDrivers={pending ? pendingCountLabel(pending) : null} />;
}
