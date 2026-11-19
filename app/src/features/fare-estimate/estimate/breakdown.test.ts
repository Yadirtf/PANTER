import { describe, expect, it } from 'vitest';
import { makeEstimate } from '../test-helpers';
import { mapBreakdown } from './breakdown';
import { formatCop, formatDistance, formatDuration } from './format';
import { quoteValidity } from './quote-validity';

describe('formatCop', () => {
  it('pesos con punto de miles', () => {
    expect(formatCop(19_500)).toBe('$ 19.500');
    expect(formatCop(4_000)).toBe('$ 4.000');
    expect(formatCop(250)).toBe('$ 250');
    expect(formatCop(0)).toBe('$ 0');
    expect(formatCop(1_250_000)).toBe('$ 1.250.000');
    expect(formatCop(-300)).toBe('-$ 300');
  });
});

describe('distancia y tiempo', () => {
  it('metros y kilómetros con coma', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(6_340)).toBe('6,3 km');
    expect(formatDistance(12_000)).toBe('12 km');
  });

  it('minutos y horas', () => {
    expect(formatDuration(30)).toBe('1 min');
    expect(formatDuration(840)).toBe('14 min');
    expect(formatDuration(3_600)).toBe('1 h');
    expect(formatDuration(3_900)).toBe('1 h 5 min');
  });
});

describe('mapBreakdown', () => {
  it('taxi: base, distancia, tiempo, recargo aeropuerto y redondeo con sus labels', () => {
    const view = mapBreakdown(makeEstimate());
    expect(view.rows.map((r) => [r.code, r.label, r.formatted, r.kind])).toEqual([
      ['BASE', 'Banderazo', '$ 4.000', 'fare'],
      ['DISTANCE', 'Distancia (6,3 km)', '$ 9.450', 'fare'],
      ['TIME', 'Tiempo (14 min)', '$ 2.800', 'fare'],
      ['AIRPORT', 'Recargo aeropuerto Cananguchal', '+$ 3.000', 'surcharge'],
      ['ROUNDING', 'Redondeo', '+$ 250', 'rounding'],
    ]);
    expect(view.formattedTotal).toBe('$ 19.500');
    expect(view.consistent).toBe(true);
  });

  it('mototaxi nocturno con mínima y periferia, en el orden del cálculo', () => {
    const view = mapBreakdown(
      makeEstimate({
        total: 9_000,
        breakdown: [
          { code: 'ROUNDING', label: 'Redondeo', amount: 0 },
          { code: 'PERIPHERAL', label: 'Recargo vereda El Porvenir', amount: 1_500 },
          { code: 'NIGHT', label: 'Recargo nocturno', amount: 1_000 },
          { code: 'MINIMUM_ADJUSTMENT', label: 'Ajuste a la tarifa mínima', amount: 500 },
          { code: 'BASE', label: 'Tarifa del viaje', amount: 6_000 },
        ],
      }),
    );
    expect(view.rows.map((r) => r.code)).toEqual([
      'BASE',
      'MINIMUM_ADJUSTMENT',
      'NIGHT',
      'PERIPHERAL',
      'ROUNDING',
    ]);
    expect(view.rows.find((r) => r.code === 'MINIMUM_ADJUSTMENT')).toMatchObject({
      formatted: '+$ 500',
      kind: 'adjustment',
    });
    expect(view.consistent).toBe(true);
  });

  it('dos geocercas del mismo tipo conservan su orden; label vacío usa uno de respaldo', () => {
    const view = mapBreakdown(
      makeEstimate({
        total: 7_000,
        breakdown: [
          { code: 'BASE', label: 'Tarifa del viaje', amount: 5_000 },
          { code: 'PERIPHERAL', label: 'Recargo A', amount: 1_000 },
          { code: 'PERIPHERAL', label: ' ', amount: 1_000 },
        ],
      }),
    );
    expect(view.rows.map((r) => r.label)).toEqual([
      'Tarifa del viaje',
      'Recargo A',
      'Recargo zona periférica',
    ]);
  });

  it('marca un desglose que no suma el total', () => {
    expect(mapBreakdown(makeEstimate({ total: 1 })).consistent).toBe(false);
  });
});

describe('quoteValidity', () => {
  const validUntil = '2026-11-19T15:10:00.000Z';

  it('cuenta regresiva hasta validUntil', () => {
    expect(quoteValidity(validUntil, new Date('2026-11-19T15:00:00Z'))).toEqual({
      expired: false,
      remainingMs: 600_000,
      label: 'Precio válido por 10:00',
    });
    expect(quoteValidity(validUntil, new Date('2026-11-19T15:09:55.500Z')).label).toBe(
      'Precio válido por 0:05',
    );
  });

  it('vence justo en validUntil', () => {
    expect(quoteValidity(validUntil, new Date('2026-11-19T15:10:00Z'))).toEqual({
      expired: true,
      remainingMs: 0,
      label: 'El precio venció',
    });
    expect(quoteValidity(validUntil, new Date('2026-11-19T16:00:00Z')).expired).toBe(true);
  });
});
