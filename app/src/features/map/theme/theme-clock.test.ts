import { describe, expect, it } from 'vitest';
import { msUntilNextThemeChange, themeSchedule } from './theme-clock';

/** Instante a partir de una hora de Colombia (UTC−5) del 19/11/2026. */
const bogota = (time: string, day = '2026-11-19') => new Date(`${day}T${time}-05:00`);
const MIN = 60_000;

describe('tema del mapa por hora de Colombia', () => {
  it('claro de día y oscuro desde las 20:00 hasta antes de las 05:00', () => {
    expect(themeSchedule(bogota('12:00:00')).theme).toBe('light');
    expect(themeSchedule(bogota('19:59:59')).theme).toBe('light');
    expect(themeSchedule(bogota('20:00:00')).theme).toBe('dark');
    expect(themeSchedule(bogota('23:30:00')).theme).toBe('dark');
    expect(themeSchedule(bogota('04:59:59')).theme).toBe('dark');
    expect(themeSchedule(bogota('05:00:00')).theme).toBe('light');
  });

  it('no depende de la zona horaria del teléfono (mismo instante en UTC)', () => {
    expect(themeSchedule(new Date('2026-11-20T01:00:00Z')).theme).toBe('dark'); // 20:00 COT
    expect(themeSchedule(new Date('2026-11-19T10:00:00Z')).theme).toBe('light'); // 05:00 COT
  });
});

describe('msUntilNextThemeChange', () => {
  it('cuenta hasta las 20:00 durante el día', () => {
    expect(msUntilNextThemeChange(bogota('19:59:30'))).toBe(30_000);
    expect(msUntilNextThemeChange(bogota('12:00:00'))).toBe(8 * 60 * MIN);
    expect(msUntilNextThemeChange(bogota('05:00:00'))).toBe(15 * 60 * MIN);
  });

  it('cuenta hasta las 05:00 durante la noche, cruzando la medianoche', () => {
    expect(msUntilNextThemeChange(bogota('20:00:00'))).toBe(9 * 60 * MIN);
    expect(msUntilNextThemeChange(bogota('23:59:00'))).toBe(5 * 60 * MIN + MIN);
    expect(msUntilNextThemeChange(bogota('04:59:00'))).toBe(MIN);
  });

  it('al reevaluar justo después del cambio, el tema ya es el nuevo', () => {
    const before = bogota('19:59:00');
    const after = new Date(before.getTime() + msUntilNextThemeChange(before) + 1_000);
    expect(themeSchedule(after).theme).toBe('dark');
  });
});
