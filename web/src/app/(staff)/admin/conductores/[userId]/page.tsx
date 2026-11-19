import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { consentPathFor } from '@/features/auth/server/consent-gate';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/features/auth/server/cookies';
import { DriverDetailView } from '@/features/drivers/components/driver-detail-view';
import { adminDriverDetailPath } from '@/features/drivers/lib/drivers';
import { driversApi } from '@/features/drivers/server/deps';
import { loadDriverDetail } from '@/features/drivers/server/load-drivers';

export const metadata: Metadata = { title: 'Revisión de conductor', robots: { index: false } };

/**
 * /admin/conductores/[userId] (HU-204). Se renderiza en cada visita: las URLs firmadas de
 * lectura de los documentos se piden en ese momento.
 */
export default async function AdminDriverDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  if (!z.uuid().safeParse(userId).success) {
    return <DriverDetailView load={{ kind: 'error', code: 'NOT_FOUND' }} />;
  }
  const jar = await cookies();
  const load = await loadDriverDetail(
    driversApi,
    { accessToken: jar.get(ACCESS_COOKIE)?.value, refreshToken: jar.get(REFRESH_COOKIE)?.value },
    userId,
  );
  const next = adminDriverDetailPath(userId);
  if (load.kind === 'renew') redirect(`/api/session/refresh?next=${encodeURIComponent(next)}`);
  if (load.kind === 'consent') redirect(consentPathFor(next));
  return <DriverDetailView load={load} />;
}
