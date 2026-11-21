import { describe, expect, it } from 'vitest';
import {
  ALTO_SINAI,
  CENTRO,
  SAN_JOSE,
  square,
  VIEJO,
} from '@/features/catalog/server/catalog-test-data';
import { toEditable } from './polygon-edit';
import { overlapping, polygonsOverlap } from './polygon-validation';

describe('solapamiento entre polígonos', () => {
  it('dos barrios vecinos que comparten un borde no se solapan', () => {
    expect(polygonsOverlap(CENTRO.polygon, SAN_JOSE.polygon)).toBe(false);
  });

  it('compartir solo una esquina tampoco', () => {
    const corner = [square(-76.613, 1.033, -76.606, 1.04)];
    expect(polygonsOverlap(CENTRO.polygon, corner)).toBe(false);
  });

  it('polígonos lejanos no se solapan', () => {
    expect(polygonsOverlap(CENTRO.polygon, ALTO_SINAI.polygon)).toBe(false);
  });

  it('lados que se cruzan: se solapan', () => {
    const shifted = [square(-76.616, 1.03, -76.61, 1.036)];
    expect(polygonsOverlap(CENTRO.polygon, shifted)).toBe(true);
    expect(polygonsOverlap(shifted, CENTRO.polygon)).toBe(true);
  });

  it('uno dentro del otro (sin cruzar bordes): se solapan, en ambos sentidos', () => {
    expect(polygonsOverlap(CENTRO.polygon, VIEJO.polygon)).toBe(true);
    expect(polygonsOverlap(VIEJO.polygon, CENTRO.polygon)).toBe(true);
  });

  it('el mismo polígono dibujado dos veces se solapa (abierto o cerrado)', () => {
    expect(polygonsOverlap(CENTRO.polygon, toEditable(CENTRO.polygon))).toBe(true);
  });

  it('un barrio dentro del hueco de otro no se solapa con él', () => {
    const withHole = [square(-76.63, 1.02, -76.6, 1.04), square(-76.62, 1.026, -76.613, 1.033)];
    expect(polygonsOverlap(withHole, CENTRO.polygon)).toBe(false);
    expect(polygonsOverlap(withHole, VIEJO.polygon)).toBe(false);
  });

  it('overlapping devuelve solo los que se solapan', () => {
    const drawn = [square(-76.615, 1.027, -76.61, 1.032)]; // entre el Centro y San José
    expect(overlapping(drawn, [CENTRO, SAN_JOSE, ALTO_SINAI]).map((a) => a.id)).toEqual([
      CENTRO.id,
      SAN_JOSE.id,
    ]);
  });
});
