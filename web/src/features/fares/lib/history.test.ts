import { describe, expect, it } from 'vitest';
import { AIRPORT, GEOFENCE_CHANGE, RULE_CHANGE, TAXI_RULE } from '../server/fares-test-data';
import {
  appendHistoryPage,
  changeAuthor,
  changeKind,
  changeTitle,
  diffSnapshots,
  formatChangeValue,
} from './history';

describe('diff del historial campo por campo', () => {
  it('muestra solo lo que cambió, con valores legibles, sin metadatos', () => {
    expect(diffSnapshots(RULE_CHANGE.before, RULE_CHANGE.after)).toEqual([
      { field: 'baseFare', label: 'Valor base / banderazo', before: '$ 6.000', after: '$ 6.500' },
      {
        field: 'nightStartMinute',
        label: 'Inicio del horario nocturno',
        before: '20:00',
        after: '19:00',
      },
    ]);
  });

  it('acepta instantáneas en snake_case y no cuenta el orden de appliesTo como cambio', () => {
    expect(diffSnapshots(GEOFENCE_CHANGE.before, GEOFENCE_CHANGE.after)).toEqual([
      { field: 'surcharge', label: 'Recargo', before: '$ 5.000', after: '$ 6.000' },
      { field: 'active', label: 'Activa', before: 'Sí', after: 'No' },
    ]);
    expect(diffSnapshots({ applies_to: ['TAXI'] }, { applies_to: ['TAXI', 'MOTOTAXI'] })).toEqual([
      { field: 'appliesTo', label: 'Aplica a', before: 'Taxi', after: 'Mototaxi, Taxi' },
    ]);
  });

  it('creación: antes "—"; modelo, redondeo y polígono legibles', () => {
    const created = diffSnapshots(null, {
      pricingModel: 'FLAT',
      roundTo: 100,
      polygon: AIRPORT.polygon,
    });
    expect(created).toEqual([
      { field: 'pricingModel', label: 'Modelo de cobro', before: '—', after: 'Tarifa plana' },
      { field: 'roundTo', label: 'Redondeo', before: '—', after: 'Múltiplo de $ 100' },
      { field: 'polygon', label: 'Polígono', before: '—', after: 'Polígono de 5 vértices' },
    ]);
    expect(formatChangeValue('kind', 'AIRPORT')).toBe('Aeropuerto');
    expect(formatChangeValue('campoNuevo', { a: 1 })).toBe('{"a":1}');
  });

  it('sin cambios reales → lista vacía', () => {
    expect(diffSnapshots({ ...TAXI_RULE }, { ...TAXI_RULE, updatedAt: 'otra' })).toEqual([]);
  });
});

describe('encabezado de cada cambio', () => {
  it('título, tipo de cambio y autor', () => {
    expect(changeTitle(RULE_CHANGE, [])).toBe('Tarifa de Taxi');
    expect(changeTitle(GEOFENCE_CHANGE, [AIRPORT])).toBe('Geocerca Aeropuerto Cananguchal (VGZ)');
    expect(changeTitle({ ...GEOFENCE_CHANGE, entityKey: 'x', after: null, before: null }, [])).toBe(
      'Geocerca x',
    );
    expect(changeKind(RULE_CHANGE)).toBe('Modificación');
    expect(changeKind({ before: null, after: {} })).toBe('Creación');
    expect(changeAuthor(RULE_CHANGE)).toBe('admin@panter.test');
    expect(changeAuthor(GEOFENCE_CHANGE)).toBe('Sistema (valores iniciales)');
  });

  it('"Cargar más" no duplica cambios', () => {
    const merged = appendHistoryPage(
      { items: [RULE_CHANGE], nextCursor: 'c2' },
      { items: [RULE_CHANGE, GEOFENCE_CHANGE], nextCursor: null },
    );
    expect(merged.items.map((c) => c.id)).toEqual([RULE_CHANGE.id, GEOFENCE_CHANGE.id]);
    expect(merged.nextCursor).toBeNull();
  });
});
