import { describe, expect, it } from 'vitest';
import { devEchoPolicy, parseEmailAllowlist } from '../../../src/modules/email/domain/dev-echo';
import { buildOtpEmail } from '../../../src/modules/email/domain/otp-email';

describe('plantilla OTP', () => {
  it('asunto exacto "Tu código PANTER es 123456"', () => {
    expect(buildOtpEmail('123456').subject).toBe('Tu código PANTER es 123456');
  });

  it('tiene versión texto plano y HTML con el código y la vigencia', () => {
    const { text, html } = buildOtpEmail('654321');
    expect(text).toContain('654321');
    expect(text).toContain('Vence en 5 minutos.');
    expect(html).toContain('654321');
    expect(html).toContain('<html lang="es">');
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it('no incluye enlaces de ningún tipo', () => {
    const { text, html } = buildOtpEmail('123456');
    for (const body of [text, html]) {
      expect(body).not.toMatch(/https?:\/\//i);
      expect(body).not.toMatch(/www\./i);
      expect(body).not.toMatch(/<a\s/i);
      expect(body).not.toMatch(/bit\.ly|tinyurl|t\.co\//i);
    }
  });

  it('escapa el HTML y ajusta el texto de vigencia', () => {
    expect(buildOtpEmail('<b>&', 60).html).toContain('&lt;b&gt;&amp;');
    expect(buildOtpEmail('123456', 60).text).toContain('Vence en 1 minuto.');
  });
});

describe('OTP_DEV_ECHO', () => {
  const allowlist = ' Tester@Gmail.com, otra@panter.test ,,';

  it('parsea la lista blanca sin espacios ni mayúsculas', () => {
    expect([...parseEmailAllowlist(allowlist)]).toEqual(['tester@gmail.com', 'otra@panter.test']);
    expect(parseEmailAllowlist(undefined).size).toBe(0);
  });

  it('en staging con OTP_DEV_ECHO=true solo aplica a la lista blanca', () => {
    const echo = devEchoPolicy({ environment: 'staging', enabled: 'true', allowlist });
    expect(echo('tester@gmail.com')).toBe(true);
    expect(echo('TESTER@gmail.com ')).toBe(true);
    expect(echo('otra@panter.test')).toBe(true);
    expect(echo('nadie@gmail.com')).toBe(false);
  });

  it('es imposible en production aunque OTP_DEV_ECHO sea "true"', () => {
    for (const enabled of ['true', 'TRUE', ' true ']) {
      const echo = devEchoPolicy({ environment: 'production', enabled, allowlist });
      expect(echo('tester@gmail.com')).toBe(false);
    }
  });

  it('no aplica en development, con el flag apagado ni con la lista vacía', () => {
    const cases = [
      { environment: 'development', enabled: 'true', allowlist },
      { environment: 'Staging', enabled: 'true', allowlist },
      { environment: undefined, enabled: 'true', allowlist },
      { environment: 'staging', enabled: 'false', allowlist },
      { environment: 'staging', enabled: '1', allowlist },
      { environment: 'staging', enabled: undefined, allowlist },
      { environment: 'staging', enabled: 'true', allowlist: '' },
      { environment: 'staging', enabled: 'true', allowlist: undefined },
    ];
    for (const settings of cases) {
      expect(devEchoPolicy(settings)('tester@gmail.com')).toBe(false);
    }
  });
});
