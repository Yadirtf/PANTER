import { PRIVACY_POLICY, PRIVACY_POLICY_VERSION } from '@panter/contracts';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ConsentPage from '@/app/(auth)/consentimiento/page';
import LoginPage from '@/app/(auth)/login/page';
import PublicLayout from '@/app/(public)/layout';
import PrivacyPage from '@/app/(public)/privacidad/page';
import { CONSENT_UPDATED_MESSAGE } from '@/features/auth/lib/messages';
import { formatPolicyDate } from './privacy-policy-document';

/** Texto tal como queda en el HTML (React escapa comillas). */
const escaped = (text: string) => text.replace(/"/g, '&quot;');

describe('/privacidad', () => {
  it('muestra el aviso de contracts: título, versión, fecha y todas las secciones', () => {
    const html = renderToString(<PrivacyPage />);
    expect(html).toContain(PRIVACY_POLICY.title);
    expect(html).toContain(`Versión ${PRIVACY_POLICY_VERSION}`);
    expect(html).toContain(formatPolicyDate(PRIVACY_POLICY.effectiveFrom));
    for (const section of PRIVACY_POLICY.sections) {
      expect(html).toContain(section.title);
      for (const paragraph of section.paragraphs) expect(html).toContain(escaped(paragraph));
    }
  });

  it('con draft: true muestra un aviso visible de borrador', () => {
    expect(PRIVACY_POLICY.draft).toBe(true);
    expect(renderToString(<PrivacyPage />)).toMatch(/role="note"[^>]*>Borrador:/);
  });

  it('formatea la fecha de vigencia en español', () => {
    expect(formatPolicyDate('2026-11-18')).toBe('18 de noviembre de 2026');
  });
});

describe('enlaces al aviso de privacidad', () => {
  it('el pie de página público enlaza a /privacidad', () => {
    const html = renderToString(
      <PublicLayout>
        <p>contenido</p>
      </PublicLayout>,
    );
    expect(html).toMatch(/<footer[\s\S]*href="\/privacidad"[\s\S]*Aviso de privacidad/);
  });

  it('/login enlaza a /privacidad', async () => {
    const html = renderToString(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('href="/privacidad"');
  });
});

describe('/consentimiento', () => {
  it('muestra el aviso con "Acepto" y "No acepto"', async () => {
    const html = renderToString(
      await ConsentPage({ searchParams: Promise.resolve({ next: '/admin' }) }),
    );
    expect(html).toContain(PRIVACY_POLICY.title);
    expect(html).toContain('Borrador:');
    expect(html).toContain('>Acepto<');
    expect(html).toContain('>No acepto<');
    expect(html).not.toContain(escaped(CONSENT_UPDATED_MESSAGE));
  });

  it('tras recargar por CONSENT_VERSION_OUTDATED explica que el aviso cambió', async () => {
    const html = renderToString(
      await ConsentPage({ searchParams: Promise.resolve({ next: '/admin', actualizado: '1' }) }),
    );
    expect(html).toContain(escaped(CONSENT_UPDATED_MESSAGE));
  });
});
