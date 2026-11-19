import { describe, expect, it } from 'vitest';
import { msUntilNextMinute, resolveMapTheme } from './theme';

/** Instante a una hora de Colombia (UTC−5), sin depender de la zona del equipo de pruebas. */
const colombia = (hh: number, mm: number) => new Date(Date.UTC(2026, 10, 19, hh + 5, mm));

describe('tema del mapa', () => {
  it("'auto' es oscuro de 8:00 p. m. a 5:00 a. m., hora de Colombia", () => {
    expect(resolveMapTheme('auto', colombia(19, 59))).toBe('light');
    expect(resolveMapTheme('auto', colombia(20, 0))).toBe('dark');
    expect(resolveMapTheme('auto', colombia(23, 30))).toBe('dark');
    expect(resolveMapTheme('auto', colombia(4, 59))).toBe('dark');
    expect(resolveMapTheme('auto', colombia(5, 0))).toBe('light');
    expect(resolveMapTheme('auto', colombia(12, 0))).toBe('light');
  });

  it('usa la hora de Colombia aunque el navegador esté en otra zona', () => {
    // 01:30 UTC = 20:30 en Colombia (de noche), aunque en Madrid o en UTC sea de madrugada.
    expect(resolveMapTheme('auto', new Date('2026-11-20T01:30:00Z'))).toBe('dark');
    // 15:00 UTC = 10:00 en Colombia.
    expect(resolveMapTheme('auto', new Date('2026-11-19T15:00:00Z'))).toBe('light');
  });

  it('acepta el horario nocturno de la tarifa vigente', () => {
    const night = { startMinute: 19 * 60, endMinute: 6 * 60 };
    expect(resolveMapTheme('auto', colombia(19, 0), night)).toBe('dark');
    expect(resolveMapTheme('auto', colombia(5, 30), night)).toBe('dark');
  });

  it('un tema fijo no depende de la hora', () => {
    expect(resolveMapTheme('dark', colombia(12, 0))).toBe('dark');
    expect(resolveMapTheme('light', colombia(22, 0))).toBe('light');
  });

  it('se vuelve a calcular al empezar el minuto siguiente', () => {
    expect(msUntilNextMinute(new Date('2026-11-19T15:00:00.000Z'))).toBe(60_000);
    expect(msUntilNextMinute(new Date('2026-11-19T15:00:59.250Z'))).toBe(750);
  });
});
