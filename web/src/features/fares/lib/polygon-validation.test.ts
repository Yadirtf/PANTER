import type { LatLng } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import { AIRPORT, PERIPHERAL } from '../server/fares-test-data';
import { moveVertex, toEditable } from './polygon-edit';
import {
  isPolygonValid,
  polygonIssues,
  ringSelfIntersects,
  segmentsIntersect,
} from './polygon-validation';

const square = (west: number, south: number, east: number, north: number): LatLng[] => [
  { lat: south, lng: west },
  { lat: south, lng: east },
  { lat: north, lng: east },
  { lat: north, lng: west },
];

const codes = (polygon: LatLng[][]) => polygonIssues(polygon).map((i) => [i.code, i.ring]);

describe('validación del polígono en el cliente', () => {
  it('las geocercas de la semilla son válidas (con y sin hueco, abiertas o cerradas)', () => {
    expect(polygonIssues(AIRPORT.polygon)).toEqual([]);
    expect(polygonIssues(PERIPHERAL.polygon)).toEqual([]);
    expect(isPolygonValid(toEditable(PERIPHERAL.polygon))).toBe(true);
  });

  it('autointersección: un "moño" (los lados se cruzan)', () => {
    const bowtie = [
      { lat: 1.0, lng: -76.65 },
      { lat: 1.06, lng: -76.585 },
      { lat: 1.0, lng: -76.585 },
      { lat: 1.06, lng: -76.65 },
    ];
    expect(codes([bowtie])).toEqual([['self_intersection', 0]]);
    expect(polygonIssues([bowtie])[0]!.message).toBe(
      'El borde exterior se cruza consigo mismo. Mueve los vértices para que los lados no se toquen.',
    );
  });

  it('autointersección al arrastrar un vértice al otro lado del polígono', () => {
    const rings = toEditable(AIRPORT.polygon);
    // El vértice NE pasa a la izquierda del borde oeste: los lados se cruzan.
    const dragged = moveVertex(rings, { ring: 0, vertex: 2 }, { lat: 0.976, lng: -76.62 });
    expect(codes(dragged).map(([code]) => code)).toContain('self_intersection');
  });

  it('un vértice repetido (el anillo se toca a sí mismo) o un lado que vuelve sobre sí', () => {
    const a = { lat: 1.0, lng: -76.65 };
    expect(ringSelfIntersects([a, { lat: 1.0, lng: -76.6 }, a, { lat: 1.05, lng: -76.62 }])).toBe(
      true,
    );
    // Espiga: el tercer vértice vuelve sobre el primer lado.
    expect(
      ringSelfIntersects([
        { lat: 1.0, lng: -76.65 },
        { lat: 1.0, lng: -76.6 },
        { lat: 1.0, lng: -76.62 },
        { lat: 1.05, lng: -76.63 },
      ]),
    ).toBe(true);
  });

  it('un vértice repetido seguido (doble clic) no invalida el dibujo', () => {
    const ring = square(-76.65, 1.0, -76.585, 1.06);
    expect(polygonIssues([[ring[0]!, ...ring]])).toEqual([]);
  });

  it('fuera del área de servicio', () => {
    // Pasto (−77.28) está al occidente de la caja de servicio (−77.05).
    const outside = square(-77.3, 1.0, -77.2, 1.1);
    expect(codes([outside])).toEqual([['outside_service_area', 0]]);
    const partly = moveVertex(
      [square(-76.65, 1.0, -76.585, 1.06)],
      { ring: 0, vertex: 2 },
      {
        lat: 1.35,
        lng: -76.585,
      },
    );
    expect(polygonIssues(partly)[0]!.message).toMatch(/fuera del área de servicio/);
  });

  it('menos de 3 vértices (o 3 en línea recta)', () => {
    expect(
      codes([
        [
          { lat: 1, lng: -76.6 },
          { lat: 1.01, lng: -76.6 },
        ],
      ]),
    ).toEqual([['too_few_vertices', 0]]);
    expect(polygonIssues([[]])[0]!.code).toBe('empty');
    expect(polygonIssues([])[0]!.code).toBe('empty');
    const line = [
      { lat: 1.0, lng: -76.6 },
      { lat: 1.01, lng: -76.6 },
      { lat: 1.02, lng: -76.6 },
    ];
    expect(codes([line]).map(([code]) => code)).toEqual(['self_intersection']);
  });

  describe('con huecos (casco urbano dentro de la zona periférica)', () => {
    const outer = square(-76.65, 1.0, -76.585, 1.06);
    const urban = square(-76.628, 1.02, -76.605, 1.04);

    it('hueco dentro del borde: válido', () => {
      expect(polygonIssues([outer, urban])).toEqual([]);
    });

    it('hueco que cruza el borde exterior', () => {
      const crossing = square(-76.66, 1.02, -76.605, 1.04);
      expect(codes([outer, crossing])).toEqual([['rings_cross', 1]]);
    });

    it('hueco fuera del borde exterior', () => {
      const away = square(-76.55, 1.02, -76.53, 1.04);
      expect(codes([outer, away])).toEqual([['hole_outside', 1]]);
      expect(polygonIssues([outer, away])[0]!.message).toBe(
        'El hueco 1 queda fuera del borde exterior.',
      );
    });

    it('huecos que se cruzan o uno dentro de otro', () => {
      const overlapping = square(-76.61, 1.03, -76.6, 1.05);
      expect(codes([outer, urban, overlapping])).toEqual([['rings_cross', 1]]);
      const inner = square(-76.62, 1.025, -76.61, 1.035);
      expect(codes([outer, urban, inner])).toEqual([['hole_in_hole', 2]]);
    });

    it('un hueco que se cruza consigo mismo', () => {
      const bowtie = [urban[0]!, urban[2]!, urban[1]!, urban[3]!];
      expect(codes([outer, bowtie])).toEqual([['self_intersection', 1]]);
    });
  });
});

describe('segmentos', () => {
  const a = { lat: 0, lng: 0 };
  const b = { lat: 1, lng: 1 };
  it('se cruzan, se tocan en un extremo o son colineales y se solapan', () => {
    expect(
      segmentsIntersect(
        [a, b],
        [
          { lat: 1, lng: 0 },
          { lat: 0, lng: 1 },
        ],
      ),
    ).toBe(true);
    expect(segmentsIntersect([a, b], [b, { lat: 2, lng: 0 }])).toBe(true);
    expect(
      segmentsIntersect(
        [a, b],
        [
          { lat: 0.5, lng: 0.5 },
          { lat: 2, lng: 2 },
        ],
      ),
    ).toBe(true);
  });
  it('paralelos o separados no se cruzan', () => {
    expect(
      segmentsIntersect(
        [a, b],
        [
          { lat: 0, lng: 1 },
          { lat: 1, lng: 2 },
        ],
      ),
    ).toBe(false);
    expect(
      segmentsIntersect(
        [a, b],
        [
          { lat: 2, lng: 2 },
          { lat: 3, lng: 3 },
        ],
      ),
    ).toBe(false);
  });
});
