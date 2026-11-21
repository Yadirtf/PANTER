import { AreaCreateBodySchema } from '@panter/contracts';
import { describe, expect, it } from 'vitest';
import {
  addDrawVertex,
  canCloseDrawing,
  closeDrawing,
  deleteVertex,
  DRAW_TOO_FEW_MESSAGE,
  insertMidpoint,
  moveVertex,
  toPolygonPayload,
  undoDrawVertex,
  type DrawDraft,
} from './polygon-edit';
import { draftFeatureCollection } from './polygon-map';
import { polygonIssues } from './polygon-validation';

/** Clics sobre el casco urbano de Villagarzón, en sentido antihorario. */
const CLICKS = [
  { lat: 1.0261234567, lng: -76.6201234567 },
  { lat: 1.026, lng: -76.613 },
  { lat: 1.033, lng: -76.613 },
  { lat: 1.033, lng: -76.62 },
];

const draw = (points = CLICKS): DrawDraft =>
  points.reduce<DrawDraft>((draft, p) => addDrawVertex(draft, p), []);

describe('dibujar un polígono nuevo (clic por vértice)', () => {
  it('cada clic agrega un vértice redondeado a 6 decimales, sin mutar el dibujo anterior', () => {
    const one = addDrawVertex([], CLICKS[0]!);
    const two = addDrawVertex(one, CLICKS[1]!);
    expect(one).toEqual([{ lat: 1.026123, lng: -76.620123 }]);
    expect(two).toHaveLength(2);
    expect(one).toHaveLength(1);
  });

  it('un doble clic en el mismo punto no agrega un vértice repetido', () => {
    const draft = addDrawVertex(draw(CLICKS.slice(0, 2)), CLICKS[1]!);
    expect(draft).toHaveLength(2);
  });

  it('deshacer quita el último vértice', () => {
    expect(undoDrawVertex(draw())).toEqual(draw(CLICKS.slice(0, 3)));
    expect(undoDrawVertex([])).toEqual([]);
  });

  it('no se cierra con menos de 3 vértices distintos', () => {
    expect(canCloseDrawing(draw(CLICKS.slice(0, 2)))).toBe(false);
    expect(closeDrawing(draw(CLICKS.slice(0, 2)))).toEqual({
      ok: false,
      message: DRAW_TOO_FEW_MESSAGE,
    });
  });

  it('al cerrar queda un anillo abierto, válido, que se envía cerrado y cumple el contrato', () => {
    const result = closeDrawing(draw());
    if (!result.ok) throw new Error(result.message);
    expect(result.rings).toEqual([draw()]);
    expect(polygonIssues(result.rings)).toEqual([]);
    const polygon = toPolygonPayload(result.rings);
    expect(polygon[0]).toHaveLength(5);
    expect(polygon[0]![0]).toEqual(polygon[0]!.at(-1));
    expect(
      AreaCreateBodySchema.safeParse({ name: 'Centro', kind: 'BARRIO', polygon }).success,
    ).toBe(true);
  });

  it('si el último clic cae sobre el primero, se cierra sin duplicarlo', () => {
    const result = closeDrawing([...draw(), draw()[0]!]);
    expect(result.ok && result.rings[0]).toHaveLength(4);
  });

  it('el polígono cerrado se edita con el mismo editor: mover, insertar y borrar vértices', () => {
    const closed = closeDrawing(draw());
    if (!closed.ok) throw new Error(closed.message);
    const moved = moveVertex(closed.rings, { ring: 0, vertex: 2 }, { lat: 1.034, lng: -76.612 });
    const { rings: inserted } = insertMidpoint(moved, 0, 0);
    expect(inserted[0]).toHaveLength(5);
    const deleted = deleteVertex(inserted, { ring: 0, vertex: 1 });
    expect(deleted.ok && deleted.rings[0]).toHaveLength(4);
  });

  it('GeoJSON del dibujo: la línea abierta y los vértices, con el primero marcado', () => {
    const fc = draftFeatureCollection(draw(CLICKS.slice(0, 3)));
    expect(fc.features.map((f) => f.geometry.type)).toEqual([
      'LineString',
      'Point',
      'Point',
      'Point',
    ]);
    expect(fc.features[1]!.properties).toEqual({ first: true, index: 0 });
    expect(fc.features[2]!.properties).toEqual({ first: false, index: 1 });
    expect(draftFeatureCollection([CLICKS[0]!]).features).toHaveLength(1);
  });
});
