import type { Metadata } from 'next';
import { ConsentScreen } from '@/features/auth/components/consent-screen';
import { CONSENT_UPDATED_PARAM } from '@/features/auth/lib/messages';
import { safeNextPath } from '@/features/navigation/role-home';

export const metadata: Metadata = { title: 'Aviso de privacidad', robots: { index: false } };

/** Consentimiento del personal en el primer ingreso (HU-109). middleware.ts exige sesión. */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : null) ?? undefined;
  return <ConsentScreen next={next} updated={params[CONSENT_UPDATED_PARAM] === '1'} />;
}
