import type * as Contracts from '@panter/contracts';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PrivacyPolicyDocument } from './privacy-policy-document';

// El aviso aprobado (draft: false) no debe mostrar el aviso de borrador.
vi.mock('@panter/contracts', async (importOriginal) => {
  const original = await importOriginal<typeof Contracts>();
  return { ...original, PRIVACY_POLICY: { ...original.PRIVACY_POLICY, draft: false } };
});

describe('aviso de privacidad aprobado', () => {
  it('con draft: false no muestra "Borrador"', () => {
    const html = renderToString(<PrivacyPolicyDocument />);
    expect(html).not.toContain('Borrador');
    expect(html).toContain('Responsable del tratamiento');
  });
});
