/**
 * Rangos de bytes (RFC 9110 §14) y validadores condicionales para el protocolo PMTiles, que lee
 * el archivo por partes: primero la cabecera (bytes 0–16383) y luego directorios y teselas.
 */

/** Rango concreto y ya validado contra el tamaño del objeto. */
export interface ByteRange {
  offset: number;
  length: number;
}

export type RangeResolution =
  /** Sin cabecera Range (o con una que se debe ignorar): se sirve el objeto completo. */
  | { kind: 'full' }
  | { kind: 'partial'; range: ByteRange }
  /** Sintaxis válida pero fuera del objeto: 416. */
  | { kind: 'unsatisfiable' };

const SINGLE_RANGE_RE = /^bytes=(\d*)-(\d*)$/i;

/**
 * Resuelve la cabecera Range contra el tamaño del objeto. Solo se admite un rango; una cabecera
 * mal formada, con otra unidad o con varios rangos se ignora y se sirve el objeto completo, como
 * permite la RFC. `bytes=a-b` con b ≥ tamaño se recorta al final del objeto.
 */
export function resolveRange(header: string | null | undefined, size: number): RangeResolution {
  if (!header) return { kind: 'full' };
  const match = SINGLE_RANGE_RE.exec(header.trim());
  if (!match) return { kind: 'full' };
  const [, startText = '', endText = ''] = match;
  if (startText === '' && endText === '') return { kind: 'full' };

  if (startText === '') {
    // Sufijo: los últimos N bytes.
    const suffix = Number(endText);
    if (suffix === 0 || size === 0) return { kind: 'unsatisfiable' };
    const length = Math.min(suffix, size);
    return { kind: 'partial', range: { offset: size - length, length } };
  }

  const start = Number(startText);
  if (start >= size) return { kind: 'unsatisfiable' };
  if (endText === '') return { kind: 'partial', range: { offset: start, length: size - start } };

  const end = Number(endText);
  if (end < start) return { kind: 'full' };
  const last = Math.min(end, size - 1);
  return { kind: 'partial', range: { offset: start, length: last - start + 1 } };
}

/** Valor de Content-Range de una respuesta 206. */
export function contentRange(range: ByteRange, size: number): string {
  return `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`;
}

/** Valor de Content-Range de una respuesta 416. */
export function unsatisfiedRange(size: number): string {
  return `bytes */${size}`;
}

function opaqueTag(tag: string): string {
  const trimmed = tag.trim();
  return trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed;
}

/**
 * If-None-Match con comparación débil (RFC 9110 §13.1.2): true si el ETag actual está en la
 * lista o la lista es `*`. Entonces se responde 304 sin cuerpo.
 */
export function etagMatches(ifNoneMatch: string | null | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === '*') return true;
  const current = opaqueTag(etag);
  return ifNoneMatch.split(',').some((candidate) => opaqueTag(candidate) === current);
}
