import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AreasView } from '@/features/areas/components/areas-view';
import { ADMIN_AREAS_PATH } from '@/features/areas/lib/areas';
import { consentPathFor } from '@/features/auth/server/consent-gate';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/features/auth/server/cookies';
import { catalogApi } from '@/features/catalog/server/deps';
import { loadAreasPage } from '@/features/catalog/server/load-catalog';

export const metadata: Metadata = { title: 'Barrios y veredas', robots: { index: false } };

/** /admin/barrios (HU-309). middleware.ts ya exige ADMIN; la API lo vuelve a comprobar. */
export default async function AdminAreasPage() {
  const jar = await cookies();
  const areas = await loadAreasPage(catalogApi, {
    accessToken: jar.get(ACCESS_COOKIE)?.value,
    refreshToken: jar.get(REFRESH_COOKIE)?.value,
  });
  if (areas.kind === 'renew') {
    redirect(`/api/session/refresh?next=${encodeURIComponent(ADMIN_AREAS_PATH)}`);
  }
  if (areas.kind === 'consent') redirect(consentPathFor(ADMIN_AREAS_PATH));
  return <AreasView areas={areas} />;
}
