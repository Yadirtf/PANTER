import { FareComponentSchema, PLACES, type FareRule } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { AIRPORT, CONFIG, MOTOTAXI_RULE, PERIPHERAL, TAXI_RULE } from '../server/fares-test-data';
import {
  approximateTrip,
  estimateFare,
  PREVIEW_CASES,
  URBAN_DESTINATION,
  type TripInput,
} from './estimate';
import { ruleBody } from './fares';

const input = (rule: FareRule) => ({ ...ruleBody(rule), vehicleType: rule.vehicleType });

function trip(overrides: Partial<TripInput> = {}): TripInput {
  return {
    vehicleType: 'TAXI',
    origin: PLACES.VILLAGARZON_CENTER,
    destination: URBAN_DESTINATION,
    distanceMeters: 4000,
    durationSeconds: 600,
    departMinute: 600,
    ...overrides,
  };
}

const codes = (estimate: ReturnType<typeof estimateFare>) => estimate.breakdown.map((c) => c.code);
const sum = (estimate: ReturnType<typeof estimateFare>) =>
  estimate.breakdown.reduce((total, c) => total + c.amount, 0);

describe('estimateFare (mismo desglose que POST /fares/estimate)', () => {
  it('METERED: banderazo + distancia + tiempo, redondeado hacia arriba', () => {
    const estimate = estimateFare(input(TAXI_RULE), [], trip({ distanceMeters: 4060 }));
    // 6.000 + 1.200 × 4,06 = 4.872 + 150 × 10 = 1.500 → 12.372 → 12.400
    expect(estimate.breakdown).toEqual([
      { code: 'BASE', label: 'Banderazo', amount: 6000 },
      { code: 'DISTANCE', label: 'Distancia (4,1 km)', amount: 4872 },
      { code: 'TIME', label: 'Tiempo (10 min)', amount: 1500 },
      { code: 'ROUNDING', label: 'Redondeo al múltiplo de $ 100', amount: 28 },
    ]);
    expect(estimate.total).toBe(12400);
    expect(estimate.isNight).toBe(false);
  });

  it('aplica la tarifa mínima antes de los recargos', () => {
    const estimate = estimateFare(
      { ...input(TAXI_RULE), minimumFare: 9000 },
      [],
      trip({ distanceMeters: 1000, durationSeconds: 120 }),
    );
    // 6.000 + 1.200 + 300 = 7.500 → mínima 9.000
    expect(estimate.breakdown.at(-1)).toEqual({
      code: 'MINIMUM_ADJUSTMENT',
      label: 'Ajuste a la tarifa mínima',
      amount: 1500,
    });
    expect(estimate.total).toBe(9000);
  });

  it('FLAT ignora distancia y tiempo; recargo nocturno según la hora de salida', () => {
    const day = estimateFare(input(MOTOTAXI_RULE), [], trip({ vehicleType: 'MOTOTAXI' }));
    expect(day.breakdown).toEqual([{ code: 'BASE', label: 'Tarifa plana', amount: 3000 }]);
    const night = estimateFare(
      input(MOTOTAXI_RULE),
      [],
      trip({ vehicleType: 'MOTOTAXI', departMinute: 23 * 60 }),
    );
    expect(codes(night)).toEqual(['BASE', 'NIGHT']);
    expect(night.total).toBe(4000);
    expect(night.isNight).toBe(true);
  });

  it('geocercas: una vez por geocerca, solo si está activa y aplica al vehículo', () => {
    const toAirport = trip({ destination: PLACES.AIRPORT_VGZ });
    expect(codes(estimateFare(input(TAXI_RULE), [AIRPORT], toAirport))).toContain('AIRPORT');
    // Origen y destino dentro: se cobra una sola vez.
    const both = estimateFare(input(TAXI_RULE), [AIRPORT], {
      ...toAirport,
      origin: PLACES.AIRPORT_VGZ,
    });
    expect(both.breakdown.filter((c) => c.code === 'AIRPORT')).toHaveLength(1);
    expect(
      codes(estimateFare(input(TAXI_RULE), [{ ...AIRPORT, active: false }], toAirport)),
    ).not.toContain('AIRPORT');
    expect(
      codes(estimateFare(input(TAXI_RULE), [{ ...AIRPORT, appliesTo: ['MOTOTAXI'] }], toAirport)),
    ).not.toContain('AIRPORT');
    // La periférica tiene un hueco (casco urbano): el centro no paga recargo.
    const urban = trip({ vehicleType: 'MOTOTAXI' });
    expect(codes(estimateFare(input(MOTOTAXI_RULE), [PERIPHERAL], urban))).not.toContain(
      'PERIPHERAL',
    );
    const outskirts = { ...urban, destination: { lat: 1.05, lng: -76.64 } };
    const peripheral = estimateFare(input(MOTOTAXI_RULE), [PERIPHERAL], outskirts);
    expect(peripheral.breakdown).toContainEqual({
      code: 'PERIPHERAL',
      label: 'Recargo Zona periférica de Villagarzón',
      amount: 1000,
    });
  });

  it('cumple el contrato: componentes válidos, suma = total y total múltiplo de roundTo', () => {
    for (const minute of [0, 300, 600, 1199, 1200, 1439]) {
      for (const meters of [0, 950, 7423.4, 20_000]) {
        const estimate = estimateFare(input(TAXI_RULE), CONFIG.geofences, {
          ...trip({ destination: PLACES.AIRPORT_VGZ }),
          distanceMeters: meters,
          durationSeconds: meters / 7,
          departMinute: minute,
        });
        for (const c of estimate.breakdown) expect(FareComponentSchema.parse(c)).toEqual(c);
        expect(sum(estimate)).toBe(estimate.total);
        expect(estimate.total % 100).toBe(0);
        expect(estimate.breakdown[0]!.code).toBe('BASE');
      }
    }
  });
});

describe('casos fijos de la vista previa', () => {
  const byId = (id: string) => PREVIEW_CASES.find((c) => c.id === id)!;
  const rules = { MOTOTAXI: MOTOTAXI_RULE, TAXI: TAXI_RULE } as const;
  const run = (id: string) => {
    const preview = byId(id);
    const rule = rules[preview.vehicleType as 'MOTOTAXI' | 'TAXI'];
    return estimateFare(input(rule), CONFIG.geofences, approximateTrip(preview));
  };

  it('son tres: mototaxi en el centro, taxi al aeropuerto y lo mismo de noche', () => {
    expect(PREVIEW_CASES.map((c) => [c.vehicleType, c.departMinute])).toEqual([
      ['MOTOTAXI', 600],
      ['TAXI', 600],
      ['TAXI', 1290],
    ]);
  });

  it('con la semilla: mototaxi $ 3.000; taxi al aeropuerto con recargo, y de noche + $ 2.000', () => {
    expect(run('mototaxi-centro')).toMatchObject({ total: 3000, isNight: false });
    const day = run('taxi-aeropuerto');
    expect(codes(day)).toEqual(['BASE', 'DISTANCE', 'TIME', 'AIRPORT', 'ROUNDING']);
    expect(day.breakdown.find((c) => c.code === 'AIRPORT')!.label).toBe(
      'Recargo Aeropuerto Cananguchal (VGZ)',
    );
    // ~5,7 km en línea recta × 1,3 ≈ 7,5 km; a 25 km/h ≈ 18 min.
    expect(day.breakdown.find((c) => c.code === 'DISTANCE')!.label).toBe('Distancia (7,5 km)');
    expect(day.total).toBeGreaterThan(20_000);
    expect(day.total).toBeLessThan(25_000);
    const night = run('taxi-aeropuerto-noche');
    expect(night.isNight).toBe(true);
    expect(night.total - day.total).toBe(2000);
  });
});
