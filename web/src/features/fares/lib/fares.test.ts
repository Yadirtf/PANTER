import { FareRuleUpdateBodySchema } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { AIRPORT, MOTOTAXI_RULE, TAXI_RULE } from '../server/fares-test-data';
import {
  formatClock,
  formatLatLng,
  formatMoneyInput,
  formToGeofenceBody,
  formToRuleBody,
  geofenceToForm,
  isNightMinute,
  minutesToTime,
  nightRangeText,
  parseMoney,
  polygonSummary,
  ruleBody,
  ruleToForm,
  showsMeteredFields,
  timeToMinutes,
} from './fares';
import { fareErrorMessage } from './messages';

describe('conversión de horas', () => {
  it('"20:00" ↔ 1200 y "05:00" ↔ 300', () => {
    expect(timeToMinutes('20:00')).toBe(1200);
    expect(timeToMinutes('05:00')).toBe(300);
    expect(timeToMinutes('5:30')).toBe(330);
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('23:59')).toBe(1439);
    expect(minutesToTime(1200)).toBe('20:00');
    expect(minutesToTime(300)).toBe('05:00');
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(1439)).toBe('23:59');
    for (let m = 0; m < 1440; m += 7) expect(timeToMinutes(minutesToTime(m))).toBe(m);
  });

  it('rechaza horas inválidas', () => {
    for (const bad of ['24:00', '12:60', '8', '', 'ocho', '20:0', '-1:00']) {
      expect(timeToMinutes(bad)).toBeNull();
    }
  });

  it('muestra la hora como se dice en Colombia', () => {
    expect(formatClock(1200)).toBe('8:00 p. m.');
    expect(formatClock(300)).toBe('5:00 a. m.');
    expect(formatClock(0)).toBe('12:00 a. m.');
    expect(formatClock(720)).toBe('12:00 p. m.');
    expect(nightRangeText(1200, 300)).toBe('de 8:00 p. m. a 5:00 a. m. (cruza la medianoche)');
    expect(nightRangeText(60, 300)).toBe('de 1:00 a. m. a 5:00 a. m.');
  });

  it('horario nocturno: cruza la medianoche si inicio > fin', () => {
    expect(isNightMinute(1200, 1200, 300)).toBe(true);
    expect(isNightMinute(1439, 1200, 300)).toBe(true);
    expect(isNightMinute(0, 1200, 300)).toBe(true);
    expect(isNightMinute(299, 1200, 300)).toBe(true);
    expect(isNightMinute(300, 1200, 300)).toBe(false);
    expect(isNightMinute(600, 1200, 300)).toBe(false);
    expect(isNightMinute(100, 60, 300)).toBe(true);
    expect(isNightMinute(30, 60, 300)).toBe(false);
    expect(isNightMinute(500, 500, 500)).toBe(false);
  });
});

describe('montos en COP', () => {
  it('formatea mientras se escribe y acepta solo dígitos', () => {
    expect(formatMoneyInput('3000')).toBe('3.000');
    expect(formatMoneyInput('$ 3.0005')).toBe('30.005');
    expect(formatMoneyInput('0012')).toBe('12');
    expect(formatMoneyInput('abc')).toBe('');
    expect(formatMoneyInput('123456789')).toBe('1.234.567');
    expect(parseMoney('3.000')).toBe(3000);
    expect(parseMoney('$ 1.000.000')).toBe(1_000_000);
    expect(parseMoney('')).toBeNaN();
  });
});

describe('formulario de una regla', () => {
  it('ida y vuelta: regla guardada → formulario → cuerpo igual', () => {
    const form = ruleToForm(ruleBody(TAXI_RULE));
    expect(form).toMatchObject({
      baseFare: '6.000',
      perKm: '1.200',
      nightStart: '20:00',
      nightEnd: '05:00',
      roundTo: '100',
    });
    const parsed = formToRuleBody(form);
    expect(parsed).toEqual({ ok: true, body: ruleBody(TAXI_RULE) });
    // El cuerpo es exactamente lo que acepta el contrato (y valida el BFF).
    if (parsed.ok) expect(FareRuleUpdateBodySchema.safeParse(parsed.body).success).toBe(true);
  });

  it('convierte la hora editada a minutos', () => {
    const form = { ...ruleToForm(ruleBody(TAXI_RULE)), nightStart: '19:30', nightEnd: '04:15' };
    const parsed = formToRuleBody(form);
    expect(parsed.ok && [parsed.body.nightStartMinute, parsed.body.nightEndMinute]).toEqual([
      1170, 255,
    ]);
  });

  it('marca cada campo inválido con un mensaje en español', () => {
    const form = {
      ...ruleToForm(ruleBody(TAXI_RULE)),
      baseFare: '',
      minimumFare: '1.000.001',
      nightStart: '25:00',
      roundTo: '0',
    };
    const parsed = formToRuleBody(form);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual({
      baseFare: 'Escribe un valor entre $ 0 y $ 1.000.000.',
      minimumFare: 'Escribe un valor entre $ 0 y $ 1.000.000.',
      nightStart: 'Escribe la hora en formato de 24 horas, por ejemplo 20:00.',
      roundTo: 'Escribe un múltiplo entre $ 1 y $ 1.000.',
    });
  });

  it('en FLAT oculta por km y por minuto y conserva sus valores', () => {
    expect(showsMeteredFields('FLAT')).toBe(false);
    expect(showsMeteredFields('METERED')).toBe(true);
    const form = { ...ruleToForm(ruleBody(TAXI_RULE)), pricingModel: 'FLAT' as const };
    const parsed = formToRuleBody(form);
    expect(parsed.ok && parsed.body).toMatchObject({ pricingModel: 'FLAT', perKm: 1200 });
    expect(formToRuleBody(ruleToForm(ruleBody(MOTOTAXI_RULE))).ok).toBe(true);
  });
});

describe('formulario de geocerca', () => {
  it('valida nombre, recargo y al menos un vehículo; ordena appliesTo', () => {
    const form = geofenceToForm(AIRPORT);
    expect(form.surcharge).toBe('5.000');
    expect(formToGeofenceBody(form)).toEqual({
      ok: true,
      body: {
        name: 'Aeropuerto Cananguchal (VGZ)',
        surcharge: 5000,
        appliesTo: ['MOTOTAXI', 'TAXI'],
        active: true,
      },
    });
    const bad = formToGeofenceBody({ ...form, name: '   ', surcharge: '', appliesTo: [] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(Object.keys(bad.errors).sort()).toEqual(['appliesTo', 'name', 'surcharge']);
      expect(bad.errors.appliesTo).toBe('Elige al menos un tipo de vehículo.');
    }
  });

  it('resume el polígono en solo lectura', () => {
    expect(polygonSummary(AIRPORT)).toBe('5 vértices');
    expect(formatLatLng({ lat: 0.972, lng: -76.612 })).toBe('0,97200; −76,61200');
  });
});

describe('mensajes de error', () => {
  it('en español para los errores de tarifas', () => {
    expect(fareErrorMessage('FARE_RULE_NOT_FOUND')).toMatch(/No existe una tarifa/);
    expect(fareErrorMessage('FORBIDDEN')).toMatch(/solo para administradores/);
    expect(fareErrorMessage('VALIDATION_ERROR')).toMatch(/\$ 1\.000\.000/);
    expect(fareErrorMessage('NETWORK_ERROR')).toMatch(/No pudimos conectar/);
    expect(fareErrorMessage('RARO')).toMatch(/Intenta de nuevo/);
  });
});
