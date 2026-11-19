import { describe, expect, it } from 'vitest';
import { AIRPORT, PERIPHERAL } from '../server/fares-test-data';
import {
  canDeleteVertex,
  deleteVertex,
  describePolygon,
  describePolygonChange,
  insertMidpoint,
  midpoints,
  MIN_VERTICES_MESSAGE,
  moveVertex,
  samePolygon,
  toEditable,
  toPolygonPayload,
} from './polygon-edit';

describe('anillos abiertos y cerrados', () => {
  it('quita el vértice de cierre para editar y lo repone al enviar', () => {
    const rings = toEditable(PERIPHERAL.polygon);
    expect(rings).toHaveLength(2);
    expect(rings[0]).toHaveLength(4);
    expect(rings[1]).toHaveLength(4);
    expect(toPolygonPayload(rings)).toEqual(PERIPHERAL.polygon);
    expect(samePolygon(PERIPHERAL.polygon, rings)).toBe(true);
  });

  it('no modifica el polígono original', () => {
    const before = JSON.stringify(AIRPORT.polygon);
    const rings = toEditable(AIRPORT.polygon);
    moveVertex(rings, { ring: 0, vertex: 0 }, { lat: 0.97, lng: -76.61 });
    insertMidpoint(rings, 0, 0);
    deleteVertex(rings, { ring: 0, vertex: 0 });
    expect(JSON.stringify(AIRPORT.polygon)).toBe(before);
  });
});

describe('mover un vértice', () => {
  it('cambia solo ese vértice y redondea a 6 decimales', () => {
    const rings = toEditable(AIRPORT.polygon);
    const moved = moveVertex(
      rings,
      { ring: 0, vertex: 2 },
      { lat: 0.98712345678, lng: -76.5961234567 },
    );
    expect(moved[0]![2]).toEqual({ lat: 0.987123, lng: -76.596123 });
    expect(moved[0]!.filter((_, i) => i !== 2)).toEqual(rings[0]!.filter((_, i) => i !== 2));
    expect(samePolygon(AIRPORT.polygon, moved)).toBe(false);
  });

  it('mueve un vértice del hueco sin tocar el borde exterior', () => {
    const rings = toEditable(PERIPHERAL.polygon);
    const moved = moveVertex(rings, { ring: 1, vertex: 0 }, { lat: 1.021, lng: -76.627 });
    expect(moved[0]).toBe(rings[0]);
    expect(moved[1]![0]).toEqual({ lat: 1.021, lng: -76.627 });
  });

  it('error si el vértice no existe', () => {
    expect(() =>
      moveVertex(toEditable(AIRPORT.polygon), { ring: 3, vertex: 0 }, { lat: 1, lng: -76 }),
    ).toThrow(RangeError);
  });
});

describe('agregar un vértice en el punto medio de un lado', () => {
  it('lo inserta después del vértice inicial del lado', () => {
    const rings = toEditable(AIRPORT.polygon);
    // Lado 0: (0.972, −76.612) → (0.972, −76.598).
    const { rings: next, inserted } = insertMidpoint(rings, 0, 0);
    expect(inserted).toEqual({ ring: 0, vertex: 1 });
    expect(next[0]).toHaveLength(5);
    expect(next[0]![1]).toEqual({ lat: 0.972, lng: -76.605 });
  });

  it('el último lado cierra el anillo (último → primero)', () => {
    const rings = toEditable(AIRPORT.polygon);
    const { rings: next } = insertMidpoint(rings, 0, 3);
    expect(next[0]![4]).toEqual({ lat: 0.979, lng: -76.612 });
  });

  it('puntos medios de todos los lados, también de los huecos', () => {
    const list = midpoints(toEditable(PERIPHERAL.polygon));
    expect(list).toHaveLength(8);
    expect(list.filter((m) => m.ring === 1)).toHaveLength(4);
  });
});

describe('borrar un vértice', () => {
  it('lo quita si quedan al menos 3', () => {
    const rings = toEditable(AIRPORT.polygon);
    const result = deleteVertex(rings, { ring: 0, vertex: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rings[0]).toHaveLength(3);
      expect(result.rings[0]).not.toContainEqual(rings[0]![1]);
    }
  });

  it('no deja un anillo con menos de 3 vértices', () => {
    const triangle = deleteVertex(toEditable(AIRPORT.polygon), { ring: 0, vertex: 0 });
    if (!triangle.ok) throw new Error('debía poder borrar');
    expect(canDeleteVertex(triangle.rings, 0)).toBe(false);
    expect(deleteVertex(triangle.rings, { ring: 0, vertex: 0 })).toEqual({
      ok: false,
      message: MIN_VERTICES_MESSAGE,
    });
  });
});

describe('resumen del cambio para la confirmación', () => {
  it('cuenta vértices agregados, borrados y movidos', () => {
    const rings = toEditable(PERIPHERAL.polygon);
    const inserted = insertMidpoint(rings, 0, 0).rings;
    const moved = moveVertex(inserted, { ring: 1, vertex: 0 }, { lat: 1.021, lng: -76.627 });
    expect(describePolygonChange(PERIPHERAL.polygon, moved)).toEqual({
      before: '4 vértices y 1 hueco de 4 vértices',
      after: '5 vértices y 1 hueco de 4 vértices (1 vértice agregado, 1 vértice movido)',
    });
    const removed = deleteVertex(rings, { ring: 0, vertex: 0 });
    if (!removed.ok) throw new Error('debía poder borrar');
    expect(describePolygonChange(PERIPHERAL.polygon, removed.rings).after).toBe(
      '3 vértices y 1 hueco de 4 vértices (1 vértice borrado)',
    );
    expect(describePolygon(AIRPORT.polygon)).toBe('4 vértices');
    // Agregar y mover en el mismo anillo (el hueco del casco urbano).
    const both = moveVertex(
      insertMidpoint(rings, 1, 0).rings,
      { ring: 1, vertex: 0 },
      {
        lat: 1.015,
        lng: -76.635,
      },
    );
    expect(describePolygonChange(PERIPHERAL.polygon, both).after).toBe(
      '4 vértices y 1 hueco de 5 vértices (1 vértice agregado, 1 vértice movido)',
    );
  });
});
