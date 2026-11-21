import type { LatLng, PolygonRings } from '@panter/contracts';

/**
 * Operaciones puras del editor de polígonos: geocercas de tarifas (HU-304) y barrios y veredas
 * (HU-309). Los anillos se editan ABIERTOS (sin repetir el primer vértice al final); al enviar
 * se cierran. Anillo 0 = borde exterior; los demás son huecos (p. ej. el casco urbano dentro de
 * la zona periférica).
 */
export type EditableRings = LatLng[][];

export interface VertexRef {
  ring: number;
  vertex: number;
}

/** Mínimo de vértices de cada anillo. */
export const MIN_RING_VERTICES = 3;

/** Seis decimales ≈ 11 cm: suficiente para una geocerca y evita ruido en el historial. */
export function roundCoord(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

const same = (a: LatLng, b: LatLng) => a.lat === b.lat && a.lng === b.lng;

/** Anillo sin el vértice de cierre. */
export function openRing(ring: readonly LatLng[]): LatLng[] {
  const out = ring.map((p) => ({ lat: p.lat, lng: p.lng }));
  if (out.length > 1 && same(out[0]!, out[out.length - 1]!)) out.pop();
  return out;
}

export function toEditable(polygon: PolygonRings): EditableRings {
  return polygon.map(openRing);
}

/** Anillos cerrados para PUT /admin/fares/geofences/:id (el mismo formato que devuelve la API). */
export function toPolygonPayload(rings: EditableRings): LatLng[][] {
  return rings.map((ring) => (ring.length === 0 ? [] : [...ring, { ...ring[0]! }]));
}

/** ¿Mismo polígono? (compara los anillos abiertos, sin importar si venían cerrados). */
export function samePolygon(a: PolygonRings, b: PolygonRings): boolean {
  const ra = toEditable(a);
  const rb = toEditable(b);
  return (
    ra.length === rb.length &&
    ra.every(
      (ring, r) => ring.length === rb[r]!.length && ring.every((p, i) => same(p, rb[r]![i]!)),
    )
  );
}

function replaceRing(rings: EditableRings, index: number, ring: LatLng[]): EditableRings {
  return rings.map((current, r) => (r === index ? ring : current));
}

function assertVertex(rings: EditableRings, { ring, vertex }: VertexRef): void {
  if (!rings[ring] || vertex < 0 || vertex >= rings[ring].length) {
    throw new RangeError(`No existe el vértice ${vertex} del anillo ${ring}`);
  }
}

/** Mueve un vértice (al arrastrarlo en el mapa). */
export function moveVertex(rings: EditableRings, ref: VertexRef, to: LatLng): EditableRings {
  assertVertex(rings, ref);
  const ring = rings[ref.ring]!.map((p, i) =>
    i === ref.vertex ? { lat: roundCoord(to.lat), lng: roundCoord(to.lng) } : p,
  );
  return replaceRing(rings, ref.ring, ring);
}

/** Punto medio del lado que va del vértice `side` al siguiente (el último lado cierra el anillo). */
export function sideMidpoint(ring: readonly LatLng[], side: number): LatLng {
  const a = ring[side]!;
  const b = ring[(side + 1) % ring.length]!;
  return { lat: roundCoord((a.lat + b.lat) / 2), lng: roundCoord((a.lng + b.lng) / 2) };
}

export interface Midpoint {
  ring: number;
  side: number;
  position: LatLng;
}

/** Puntos medios de todos los lados: al hacer clic en uno se agrega un vértice ahí. */
export function midpoints(rings: EditableRings): Midpoint[] {
  return rings.flatMap((ring, r) =>
    ring.length < 2
      ? []
      : ring.map((_, side) => ({ ring: r, side, position: sideMidpoint(ring, side) })),
  );
}

/** Agrega un vértice en el punto medio del lado `side`; devuelve el vértice nuevo. */
export function insertMidpoint(
  rings: EditableRings,
  ringIndex: number,
  side: number,
): { rings: EditableRings; inserted: VertexRef } {
  assertVertex(rings, { ring: ringIndex, vertex: side });
  const ring = [...rings[ringIndex]!];
  ring.splice(side + 1, 0, sideMidpoint(ring, side));
  return {
    rings: replaceRing(rings, ringIndex, ring),
    inserted: { ring: ringIndex, vertex: side + 1 },
  };
}

export type DeleteResult = { ok: true; rings: EditableRings } | { ok: false; message: string };

export const MIN_VERTICES_MESSAGE = `Cada borde necesita al menos ${MIN_RING_VERTICES} vértices: no se puede borrar este.`;

/** Borra un vértice manteniendo el mínimo de 3 por anillo. */
export function deleteVertex(rings: EditableRings, ref: VertexRef): DeleteResult {
  assertVertex(rings, ref);
  const ring = rings[ref.ring]!;
  if (ring.length <= MIN_RING_VERTICES) return { ok: false, message: MIN_VERTICES_MESSAGE };
  return {
    ok: true,
    rings: replaceRing(
      rings,
      ref.ring,
      ring.filter((_, i) => i !== ref.vertex),
    ),
  };
}

export function canDeleteVertex(rings: EditableRings, ringIndex: number): boolean {
  return (rings[ringIndex]?.length ?? 0) > MIN_RING_VERTICES;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "5 vértices y 1 hueco". */
export function describePolygon(polygon: PolygonRings): string {
  const [outer, ...holes] = toEditable(polygon);
  const base = plural(outer?.length ?? 0, 'vértice', 'vértices');
  if (holes.length === 0) return base;
  const sizes = holes.map((h) => h.length);
  return holes.length === 1
    ? `${base} y 1 hueco de ${plural(sizes[0]!, 'vértice', 'vértices')}`
    : `${base} y ${holes.length} huecos (${sizes.join(', ')} vértices)`;
}

/**
 * Resumen del cambio del polígono para la confirmación: "4 vértices y 1 hueco de 4 vértices" →
 * "5 vértices y 1 hueco de 4 vértices (1 vértice agregado, 2 vértices movidos)".
 */
export function describePolygonChange(
  before: PolygonRings,
  after: PolygonRings,
): { before: string; after: string } {
  const a = toEditable(before);
  const b = toEditable(after);
  let added = 0;
  let removed = 0;
  let moved = 0;
  b.forEach((ring, r) => {
    const old = a[r] ?? [];
    const grew = Math.max(0, ring.length - old.length);
    const shrank = Math.max(0, old.length - ring.length);
    // Vértices en posiciones nuevas: los agregados y, el resto, movidos.
    const fresh = ring.filter((p) => !old.some((q) => same(p, q))).length;
    added += grew;
    removed += shrank;
    moved += Math.max(0, fresh - grew);
  });
  for (let r = b.length; r < a.length; r++) removed += a[r]!.length;
  const parts = [
    added ? plural(added, 'vértice agregado', 'vértices agregados') : '',
    removed ? plural(removed, 'vértice borrado', 'vértices borrados') : '',
    moved ? plural(moved, 'vértice movido', 'vértices movidos') : '',
  ].filter(Boolean);
  const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  return { before: describePolygon(before), after: `${describePolygon(after)}${detail}` };
}

// --- Dibujo de un polígono nuevo (HU-309) ---

/**
 * Polígono en dibujo: los vértices en el orden en que se hizo clic. Se cierra con un clic sobre
 * el primer vértice (o con «Cerrar polígono») cuando tiene al menos 3; desde ahí se edita como
 * cualquier otro polígono.
 */
export type DrawDraft = LatLng[];

export const DRAW_TOO_FEW_MESSAGE = `Agrega al menos ${MIN_RING_VERTICES} vértices para cerrar el polígono.`;

/** Agrega un vértice al final del dibujo (redondeado); un clic repetido en el mismo punto no cuenta. */
export function addDrawVertex(draft: DrawDraft, point: LatLng): DrawDraft {
  const p = { lat: roundCoord(point.lat), lng: roundCoord(point.lng) };
  const last = draft[draft.length - 1];
  if (last && same(last, p)) return draft;
  return [...draft, p];
}

/** Quita el último vértice dibujado («Deshacer último punto»). */
export function undoDrawVertex(draft: DrawDraft): DrawDraft {
  return draft.slice(0, -1);
}

export function canCloseDrawing(draft: DrawDraft): boolean {
  return new Set(draft.map((p) => `${p.lat},${p.lng}`)).size >= MIN_RING_VERTICES;
}

export type CloseResult = { ok: true; rings: EditableRings } | { ok: false; message: string };

/** Cierra el dibujo: pasa a ser un polígono de un solo anillo, editable con el resto del editor. */
export function closeDrawing(draft: DrawDraft): CloseResult {
  if (!canCloseDrawing(draft)) return { ok: false, message: DRAW_TOO_FEW_MESSAGE };
  return { ok: true, rings: [openRing(draft)] };
}
