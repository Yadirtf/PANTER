import { PrivacyPolicyDocument } from '@/features/privacy/components/privacy-policy-document';
import { CONSENT_UPDATED_MESSAGE } from '../lib/messages';
import { ConsentForm } from './consent-form';

/** /consentimiento: aviso de privacidad con "Acepto" y "No acepto" (HU-109). */
export function ConsentScreen({ next, updated }: { next?: string; updated: boolean }) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase">
        Antes de continuar
      </p>
      {updated ? (
        <p role="status" className="rounded-lg bg-sky-50 px-4 py-3 text-sky-900">
          {CONSENT_UPDATED_MESSAGE}
        </p>
      ) : null}
      <div className="max-h-[60vh] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6">
        <PrivacyPolicyDocument />
      </div>
      <ConsentForm next={next} />
    </main>
  );
}
