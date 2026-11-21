import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { consentPathFor } from '@/features/auth/server/consent-gate';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/features/auth/server/cookies';
import { catalogApi } from '@/features/catalog/server/deps';
import { loadPlacesPage } from '@/features/catalog/server/load-catalog';
import { PlacesView } from '@/features/places/components/places-view';
import { ADMIN_PLACES_PATH } from '@/features/places/lib/places';

export const metadata: Metadata = { title: 'Lugares', robots: { index: false } };

/** /admin/lugares (HU-310). middleware.ts ya exige ADMIN; la API lo vuelve a comprobar. */
export default async function AdminPlacesPage() {
  const jar = await cookies();
  const places = await loadPlacesPage(catalogApi, {
    accessToken: jar.get(ACCESS_COOKIE)?.value,
    refreshToken: jar.get(REFRESH_COOKIE)?.value,
  });
  if (places.kind === 'renew') {
    redirect(`/api/session/refresh?next=${encodeURIComponent(ADMIN_PLACES_PATH)}`);
  }
  if (places.kind === 'consent') redirect(consentPathFor(ADMIN_PLACES_PATH));
  return <PlacesView places={places} />;
}
