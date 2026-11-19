import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { consentPathFor } from '@/features/auth/server/consent-gate';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/features/auth/server/cookies';
import { DriversListView } from '@/features/drivers/components/drivers-list-view';
import { driversListPath, parseDriversFilter } from '@/features/drivers/lib/drivers';
import { driversApi } from '@/features/drivers/server/deps';
import { loadDrivers } from '@/features/drivers/server/load-drivers';

export const metadata: Metadata = { title: 'Conductores', robots: { index: false } };

/** /admin/conductores (HU-204). middleware.ts ya exige ADMIN; la API lo vuelve a comprobar. */
export default async function AdminDriversPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { estado } = await searchParams;
  const filter = parseDriversFilter(estado);
  const jar = await cookies();
  const load = await loadDrivers(
    driversApi,
    { accessToken: jar.get(ACCESS_COOKIE)?.value, refreshToken: jar.get(REFRESH_COOKIE)?.value },
    filter,
  );
  const next = driversListPath(filter);
  if (load.kind === 'renew') redirect(`/api/session/refresh?next=${encodeURIComponent(next)}`);
  if (load.kind === 'consent') redirect(consentPathFor(next));
  return <DriversListView filter={filter} load={load} />;
}
