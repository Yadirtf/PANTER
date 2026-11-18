import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { consentPathFor } from '@/features/auth/server/consent-gate';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/features/auth/server/cookies';
import { FaresView } from '@/features/fares/components/fares-view';
import { ADMIN_FARES_PATH } from '@/features/fares/lib/fares';
import { faresApi } from '@/features/fares/server/deps';
import { faresRedirect, loadFaresPage } from '@/features/fares/server/load-fares';

export const metadata: Metadata = { title: 'Tarifas', robots: { index: false } };

/** /admin/tarifas (HU-403). middleware.ts ya exige ADMIN; la API lo vuelve a comprobar. */
export default async function AdminFaresPage() {
  const jar = await cookies();
  const load = await loadFaresPage(faresApi, {
    accessToken: jar.get(ACCESS_COOKIE)?.value,
    refreshToken: jar.get(REFRESH_COOKIE)?.value,
  });
  const redirectTo = faresRedirect(load);
  if (redirectTo === 'renew') {
    redirect(`/api/session/refresh?next=${encodeURIComponent(ADMIN_FARES_PATH)}`);
  }
  if (redirectTo === 'consent') redirect(consentPathFor(ADMIN_FARES_PATH));
  const { config, history } = load;
  if (config.kind === 'renew' || config.kind === 'consent') return null;
  if (history.kind === 'renew' || history.kind === 'consent') return null;
  return <FaresView config={config} history={history} />;
}
