import { KEY_PLACES } from '@panter/map-style';
import { describe, expect, it } from 'vitest';
import { poiFromGoogle, poiFromKeyPlace, poiName } from './poi';

describe('poiName', () => {
  it('primera línea, sin espacios; vacío o no texto → null', () => {
    expect(poiName('  Panadería El Trigal ')).toBe('Panadería El Trigal');
    expect(poiName('Parque Central\nVillagarzón')).toBe('Parque Central');
    expect(poiName('   ')).toBeNull();
    expect(poiName('')).toBeNull();
    expect(poiName(undefined)).toBeNull();
    expect(poiName(42)).toBeNull();
  });
});

describe('poiFromGoogle', () => {
  it('nombre y posición del POI de Google, sin slug', () => {
    expect(
      poiFromGoogle({
        name: 'Droguería La Rebaja',
        coordinate: { latitude: 1.0297, longitude: -76.6162 },
      }),
    ).toEqual({
      name: 'Droguería La Rebaja',
      point: { lat: 1.0297, lng: -76.6162 },
      kind: null,
      placeSlug: null,
    });
  });

  it('sin nombre no hay POI', () => {
    expect(poiFromGoogle({ name: ' ', coordinate: { latitude: 1, longitude: -76 } })).toBeNull();
  });
});

describe('poiFromKeyPlace', () => {
  it('usa el id del punto clave como slug del catálogo', () => {
    const pozo = KEY_PLACES.find((p) => p.id === 'pozo-azul')!;
    expect(poiFromKeyPlace(pozo)).toEqual({
      name: 'Pozo Azul',
      point: pozo.position,
      kind: null,
      placeSlug: 'pozo-azul',
    });
  });
});
