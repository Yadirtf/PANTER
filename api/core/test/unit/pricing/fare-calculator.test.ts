// HU-402: cálculo puro de la tarifa con casos reales de Villagarzón (semillas 0005).
import type { FareComponent } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  colombiaMinuteOfDay,
  isNightMinute,
} from '../../../src/modules/pricing/domain/colombia-time';
import {
  calculateFare,
  zoneLabel,
  type SurchargeZone,
} from '../../../src/modules/pricing/domain/fare-calculator';
import { AIRPORT_ID, PERIPHERAL_ID, SEED_RULES } from '../../support/pricing-fakes';

const MOTOTAXI = SEED_RULES[0]!;
const TAXI = SEED_RULES[1]!;

/** Hora de Colombia (UTC−5) del 18 de noviembre de 2026 como instante. */
const col = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return Date.parse('2026-11-18T05:00:00Z') + (h! * 60 + m!) * 60_000;
};

const AIRPORT: SurchargeZone = {
  id: AIRPORT_ID,
  name: 'Aeropuerto Cananguchal (VGZ)',
  kind: 'AIRPORT',
  surcharge: 5000,
};
const PERIPHERY: SurchargeZone = {
  id: PERIPHERAL_ID,
  name: 'Zona periférica de Villagarzón',
  kind: 'PERIPHERAL',
  surcharge: 1000,
};

/** Ruta del fixture de ORS: parque principal → aeropuerto VGZ. */
const CENTRO_VGZ = { distanceMeters: 5876.4, durationSeconds: 548.9 };
const CORTA = { distanceMeters: 1200, durationSeconds: 240 };

const c = (code: FareComponent['code'], label: string, amount: number) => ({ code, label, amount });

const cases: {
  name: string;
  rule: typeof TAXI;
  route: { distanceMeters: number; durationSeconds: number };
  at: string;
  zones?: SurchargeZone[];
  total: number;
  isNight: boolean;
  breakdown: ReturnType<typeof c>[];
}[] = [
  {
    name: 'mototaxi diurno en el centro: $3.000',
    rule: MOTOTAXI,
    route: CORTA,
    at: '14:00',
    total: 3000,
    isNight: false,
    breakdown: [c('BASE', 'Tarifa del viaje', 3000)],
  },
  {
    name: 'mototaxi a las 22:00: recargo nocturno',
    rule: MOTOTAXI,
    route: CORTA,
    at: '22:00',
    total: 4000,
    isNight: true,
    breakdown: [c('BASE', 'Tarifa del viaje', 3000), c('NIGHT', 'Recargo nocturno', 1000)],
  },
  {
    name: 'mototaxi a la periferia',
    rule: MOTOTAXI,
    route: CORTA,
    at: '10:30',
    zones: [PERIPHERY],
    total: 4000,
    isNight: false,
    breakdown: [
      c('BASE', 'Tarifa del viaje', 3000),
      c('PERIPHERAL', 'Recargo zona periférica de Villagarzón', 1000),
    ],
  },
  {
    name: 'taxi centro → aeropuerto VGZ de día',
    rule: TAXI,
    route: CENTRO_VGZ,
    at: '09:15',
    zones: [AIRPORT],
    total: 19500,
    isNight: false,
    breakdown: [
      c('BASE', 'Banderazo', 6000),
      c('DISTANCE', 'Distancia (5,9 km)', 7052),
      c('TIME', 'Tiempo (9 min)', 1372),
      c('AIRPORT', 'Recargo aeropuerto Cananguchal (VGZ)', 5000),
      c('ROUNDING', 'Redondeo', 76),
    ],
  },
  {
    name: 'taxi centro → aeropuerto VGZ de noche (origen y destino en la misma geocerca cuentan una vez)',
    rule: TAXI,
    route: CENTRO_VGZ,
    at: '23:40',
    zones: [AIRPORT, AIRPORT],
    total: 21500,
    isNight: true,
    breakdown: [
      c('BASE', 'Banderazo', 6000),
      c('DISTANCE', 'Distancia (5,9 km)', 7052),
      c('TIME', 'Tiempo (9 min)', 1372),
      c('NIGHT', 'Recargo nocturno', 2000),
      c('AIRPORT', 'Recargo aeropuerto Cananguchal (VGZ)', 5000),
      c('ROUNDING', 'Redondeo', 76),
    ],
  },
  {
    name: 'taxi corto que cae en la mínima (mínima de $8.000)',
    rule: { ...TAXI, minimumFare: 8000 },
    route: { distanceMeters: 900, durationSeconds: 180 },
    at: '12:00',
    total: 8000,
    isNight: false,
    breakdown: [
      c('BASE', 'Banderazo', 6000),
      c('DISTANCE', 'Distancia (0,9 km)', 1080),
      c('TIME', 'Tiempo (3 min)', 450),
      c('MINIMUM_ADJUSTMENT', 'Ajuste a la tarifa mínima', 470),
    ],
  },
  {
    name: 'taxi con redondeo hacia arriba a $100',
    rule: TAXI,
    route: { distanceMeters: 3270, durationSeconds: 444 },
    at: '16:00',
    total: 11100,
    isNight: false,
    breakdown: [
      c('BASE', 'Banderazo', 6000),
      c('DISTANCE', 'Distancia (3,3 km)', 3924),
      c('TIME', 'Tiempo (7 min)', 1110),
      c('ROUNDING', 'Redondeo', 66),
    ],
  },
  {
    name: 'taxi parado (origen = destino): solo banderazo',
    rule: TAXI,
    route: { distanceMeters: 0, durationSeconds: 0 },
    at: '08:00',
    total: 6000,
    isNight: false,
    breakdown: [c('BASE', 'Banderazo', 6000)],
  },
];

describe('calculateFare', () => {
  it.each(cases)('$name', ({ rule, route, at, zones, total, isNight, breakdown }) => {
    const quote = calculateFare({ rule, ...route, departAt: col(at), zones: zones ?? [] });
    expect(quote).toEqual({ total, isNight, breakdown });
    expect(quote.breakdown.reduce((sum, x) => sum + x.amount, 0)).toBe(quote.total);
    expect(quote.breakdown.every((x) => Number.isInteger(x.amount))).toBe(true);
  });

  it.each([
    ['19:59', false],
    ['20:00', true],
    ['00:00', true],
    ['04:59', true],
    ['05:00', false],
  ])('límite del horario nocturno 20:00–05:00: %s → noche=%s', (at, night) => {
    const quote = calculateFare({ rule: MOTOTAXI, ...CORTA, departAt: col(at), zones: [] });
    expect(quote.isNight).toBe(night);
    expect(quote.total).toBe(night ? 4000 : 3000);
  });

  it('con recargo nocturno en $0 o sin horario nocturno no aparece el componente', () => {
    const noSurcharge = calculateFare({
      rule: { ...MOTOTAXI, nightSurcharge: 0 },
      ...CORTA,
      departAt: col('22:00'),
      zones: [],
    });
    expect(noSurcharge).toMatchObject({ total: 3000, isNight: true });
    expect(noSurcharge.breakdown.map((x) => x.code)).toEqual(['BASE']);
    const noWindow = calculateFare({
      rule: { ...MOTOTAXI, nightStartMinute: 1200, nightEndMinute: 1200 },
      ...CORTA,
      departAt: col('22:00'),
      zones: [],
    });
    expect(noWindow).toMatchObject({ total: 3000, isNight: false });
  });

  it('una geocerca con recargo $0 no aparece; redondeo a $1.000 del 4x4', () => {
    const quote = calculateFare({
      rule: SEED_RULES[2]!,
      distanceMeters: 12_340,
      durationSeconds: 1800,
      departAt: col('10:00'),
      zones: [{ ...PERIPHERY, surcharge: 0 }],
    });
    // 15.000 + 2.500 × 12,34 = 45.850 → $46.000.
    expect(quote.total).toBe(46000);
    expect(quote.breakdown.map((x) => x.code)).toEqual(['BASE', 'DISTANCE', 'ROUNDING']);
  });

  it('distancias o duraciones negativas se tratan como 0', () => {
    const quote = calculateFare({
      rule: TAXI,
      distanceMeters: -5,
      durationSeconds: -5,
      departAt: col('10:00'),
      zones: [],
    });
    expect(quote.total).toBe(6000);
  });
});

describe('hora de Colombia', () => {
  it('minuto del día en America/Bogota sin depender de la zona del servidor', () => {
    expect(colombiaMinuteOfDay(Date.parse('2026-11-19T01:00:00Z'))).toBe(20 * 60);
    expect(colombiaMinuteOfDay(Date.parse('2026-11-18T05:00:00Z'))).toBe(0);
    expect(colombiaMinuteOfDay(Date.parse('2026-06-30T10:00:00Z'))).toBe(5 * 60);
    for (let h = 0; h < 24; h++) {
      const at = Date.parse('2026-11-18T00:00:00Z') + h * 3_600_000 + 17 * 60_000;
      expect(colombiaMinuteOfDay(at)).toBe(((((h - 5) % 24) + 24) % 24) * 60 + 17);
    }
  });

  it('horario que no cruza la medianoche', () => {
    expect(isNightMinute(600, 540, 720)).toBe(true);
    expect(isNightMinute(720, 540, 720)).toBe(false);
    expect(isNightMinute(500, 540, 720)).toBe(false);
    expect(isNightMinute(600, 600, 600)).toBe(false);
  });

  it('etiqueta de la geocerca', () => {
    expect(zoneLabel(' Aeropuerto Cananguchal (VGZ) ')).toBe(
      'Recargo aeropuerto Cananguchal (VGZ)',
    );
  });
});
