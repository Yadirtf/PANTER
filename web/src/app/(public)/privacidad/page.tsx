import { PRIVACY_POLICY } from '@panter/contracts';
import type { Metadata } from 'next';
import { PrivacyPolicyDocument } from '@/features/privacy/components/privacy-policy-document';

export const metadata: Metadata = {
  title: 'Aviso de privacidad',
  description: `${PRIVACY_POLICY.title} de PANTER (versión ${PRIVACY_POLICY.version}).`,
};

/** Aviso de privacidad público (HU-109, Ley 1581 de 2012). */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <PrivacyPolicyDocument />
    </main>
  );
}
