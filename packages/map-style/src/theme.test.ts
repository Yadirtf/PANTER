import { describe, expect, it } from 'vitest';
import { colombiaMinuteOfDay, themeFor } from './theme';

/** Instante a partir de la hora de Colombia (UTC−5). */
const cot = (iso: string) => new Date(`${iso}-05:00`);

describe('themeFor (hora de Colombia)', () => {
  it('claro de día y oscuro de noche', () => {
    expect(themeFor(cot('2026-11-18T12:00:00'))).toBe('light');
    expect(themeFor(cot('2026-11-18T23:30:00'))).toBe('dark');
    expect(themeFor(cot('2026-11-19T02:00:00'))).toBe('dark');
  });

  it('límite de las 8:00 p. m.: oscuro desde 20:00:00 incluido', () => {
    expect(themeFor(cot('2026-11-18T19:59:59.999'))).toBe('light');
    expect(themeFor(cot('2026-11-18T20:00:00'))).toBe('dark');
    expect(themeFor(cot('2026-11-18T20:00:01'))).toBe('dark');
  });

  it('límite de las 5:00 a. m.: claro desde 05:00:00 incluido', () => {
    expect(themeFor(cot('2026-11-19T04:59:59.999'))).toBe('dark');
    expect(themeFor(cot('2026-11-19T05:00:00'))).toBe('light');
  });

  it('medianoche es oscuro', () => {
    expect(themeFor(cot('2026-11-19T00:00:00'))).toBe('dark');
    expect(themeFor(cot('2026-11-18T23:59:59'))).toBe('dark');
  });

  it('no depende de la zona del dispositivo: 01:00 UTC son las 20:00 en Colombia', () => {
    expect(themeFor(new Date('2026-11-19T01:00:00Z'))).toBe('dark');
    expect(themeFor(new Date('2026-11-19T00:59:59Z'))).toBe('light');
    expect(themeFor(new Date('2026-11-19T10:00:00Z'))).toBe('light');
  });

  it('acepta el horario nocturno de la tarifa vigente', () => {
    const night = { startMinute: 19 * 60, endMinute: 6 * 60 };
    expect(themeFor(cot('2026-11-18T19:00:00'), night)).toBe('dark');
    expect(themeFor(cot('2026-11-19T05:59:00'), night)).toBe('dark');
    expect(themeFor(cot('2026-11-19T06:00:00'), night)).toBe('light');
    // Horario que no cruza la medianoche.
    const sameDay = { startMinute: 60, endMinute: 120 };
    expect(themeFor(cot('2026-11-19T01:30:00'), sameDay)).toBe('dark');
    expect(themeFor(cot('2026-11-19T02:00:00'), sameDay)).toBe('light');
  });

  it('colombiaMinuteOfDay funciona también antes de 1970', () => {
    expect(colombiaMinuteOfDay(cot('2026-11-18T20:00:00'))).toBe(1200);
    expect(colombiaMinuteOfDay(cot('1960-01-01T04:59:00'))).toBe(299);
  });
});
