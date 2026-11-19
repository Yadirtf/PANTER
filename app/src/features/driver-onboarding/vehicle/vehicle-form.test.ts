import { describe, expect, it } from 'vitest';
import { makeProfile } from '../test-helpers';
import {
  applyErrorDisplay,
  changeVehicleType,
  displayPlate,
  EMPTY_VEHICLE_FORM,
  formatPlateInput,
  isVehicleTypeAvailable,
  maxVehicleYear,
  platePlaceholder,
  validateVehicleForm,
  VEHICLE_TYPE_OPTIONS,
  vehicleFormFromProfile,
  type VehicleFormValues,
} from './vehicle-form';

const NOW = new Date('2026-11-18T15:00:00Z');

const moto: VehicleFormValues = {
  vehicleType: 'MOTOTAXI',
  plate: 'ABC 12D',
  brand: ' Bajaj ',
  model: 'RE 4S',
  color: 'Verde',
  year: '2022',
};

describe('tipos de vehículo', () => {
  it('ofrece mototaxi y taxi; el campero 4x4 aparece como "Próximamente"', () => {
    expect(VEHICLE_TYPE_OPTIONS.map((o) => [o.type, o.available])).toEqual([
      ['MOTOTAXI', true],
      ['TAXI', true],
      ['JEEP_4X4', false],
    ]);
    expect(isVehicleTypeAvailable('JEEP_4X4')).toBe(false);
  });
});

describe('máscara de placa', () => {
  it('moto: 3 letras, 2 números y 1 letra, mostrada como "ABC 12D"', () => {
    expect(formatPlateInput('MOTOTAXI', 'abc12d')).toBe('ABC 12D');
    expect(formatPlateInput('MOTOTAXI', 'ABC-12-D')).toBe('ABC 12D');
    expect(formatPlateInput('MOTOTAXI', 'ab')).toBe('AB');
    expect(formatPlateInput('MOTOTAXI', 'abc1')).toBe('ABC 1');
    // Descarta lo que no encaja en la posición y lo que sobra.
    expect(formatPlateInput('MOTOTAXI', 'A1BC12D9X')).toBe('ABC 12D');
    expect(formatPlateInput('MOTOTAXI', 'ABC123')).toBe('ABC 12');
  });

  it('taxi y campero: 3 letras y 3 números', () => {
    expect(formatPlateInput('TAXI', 'xyz 987')).toBe('XYZ 987');
    expect(formatPlateInput('TAXI', 'XYZ98D')).toBe('XYZ 98');
    expect(formatPlateInput('JEEP_4X4', 'jkl123')).toBe('JKL 123');
  });

  it('sin tipo elegido acepta cualquiera de los dos formatos', () => {
    expect(formatPlateInput(null, 'abc12d')).toBe('ABC 12D');
    expect(formatPlateInput(null, 'abc123')).toBe('ABC 123');
  });

  it('al cambiar de tipo vuelve a aplicar la máscara', () => {
    expect(changeVehicleType(moto, 'TAXI').plate).toBe('ABC 12');
    expect(changeVehicleType({ ...moto, plate: 'ABC 123' }, 'MOTOTAXI').plate).toBe('ABC 12');
  });

  it('muestra la placa normalizada con espacio y da el ejemplo según el tipo', () => {
    expect(displayPlate('ABC12D')).toBe('ABC 12D');
    expect(platePlaceholder('MOTOTAXI')).toBe('ABC 12D');
    expect(platePlaceholder('TAXI')).toBe('ABC 123');
  });
});

describe('validateVehicleForm', () => {
  it('arma el cuerpo de POST /drivers/apply con la placa normalizada', () => {
    expect(validateVehicleForm(moto, NOW)).toEqual({
      ok: true,
      body: {
        vehicleType: 'MOTOTAXI',
        plate: 'ABC12D',
        brand: 'Bajaj',
        model: 'RE 4S',
        color: 'Verde',
        year: 2022,
      },
    });
  });

  it('valida la placa con isValidPlateFor según el tipo', () => {
    const result = validateVehicleForm({ ...moto, vehicleType: 'TAXI', plate: 'ABC 12' }, NOW);
    expect(result).toEqual({
      ok: false,
      errors: { plate: 'Placa inválida: 3 letras y 3 números (ej.: ABC 123).' },
    });
    expect(validateVehicleForm({ ...moto, plate: 'ABC 12' }, NOW)).toMatchObject({
      ok: false,
      errors: { plate: expect.stringContaining('ABC 12D') },
    });
  });

  it('exige todos los campos', () => {
    const result = validateVehicleForm(EMPTY_VEHICLE_FORM, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      ['brand', 'color', 'model', 'plate', 'vehicleType', 'year'].sort(),
    );
  });

  it('no acepta el campero mientras esté "Próximamente"', () => {
    const result = validateVehicleForm({ ...moto, vehicleType: 'JEEP_4X4', plate: 'ABC 123' }, NOW);
    expect(result).toMatchObject({ ok: false, errors: { vehicleType: expect.any(String) } });
  });

  it('acepta años de 1980 al siguiente al actual', () => {
    expect(maxVehicleYear(NOW)).toBe(2027);
    expect(validateVehicleForm({ ...moto, year: '1980' }, NOW).ok).toBe(true);
    expect(validateVehicleForm({ ...moto, year: '2027' }, NOW).ok).toBe(true);
    for (const year of ['1979', '2028', '22', '20a2']) {
      expect(validateVehicleForm({ ...moto, year }, NOW)).toMatchObject({
        ok: false,
        errors: { year: 'El año debe estar entre 1980 y 2027.' },
      });
    }
  });

  it('limita la longitud de marca, modelo y color', () => {
    const result = validateVehicleForm(
      { ...moto, brand: 'x'.repeat(41), model: 'y'.repeat(41), color: 'z'.repeat(31) },
      NOW,
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        brand: 'Máximo 40 caracteres.',
        model: 'Máximo 40 caracteres.',
        color: 'Máximo 30 caracteres.',
      },
    });
  });
});

describe('precarga y errores de la API', () => {
  it('precarga el formulario con el vehículo de GET /drivers/me', () => {
    expect(vehicleFormFromProfile(makeProfile())).toEqual({
      vehicleType: 'MOTOTAXI',
      plate: 'ABC 12D',
      brand: 'Bajaj',
      model: 'RE 4S',
      color: 'Verde',
      year: '2022',
    });
  });

  it('PLATE_ALREADY_REGISTERED se muestra en el campo placa', () => {
    expect(applyErrorDisplay({ code: 'PLATE_ALREADY_REGISTERED' })).toMatchObject({
      kind: 'field',
      field: 'plate',
      message: expect.stringContaining('ya está registrada'),
    });
  });

  it('DRIVER_ALREADY_APPLIED pide recargar la solicitud existente', () => {
    expect(applyErrorDisplay({ code: 'DRIVER_ALREADY_APPLIED' }).kind).toBe('alreadyApplied');
  });

  it('otros errores usan el mensaje general', () => {
    expect(applyErrorDisplay({ code: 'NETWORK_ERROR' })).toEqual({
      kind: 'general',
      message: 'No hay conexión a internet. Revisa tus datos o el wifi e intenta de nuevo.',
    });
  });
});
