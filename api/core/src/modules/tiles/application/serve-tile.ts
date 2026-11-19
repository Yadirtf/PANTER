import { etagMatches, resolveRange, type ByteRange } from '../domain/http-range';
import { resolveTileFile, type TileFile } from '../domain/tile-file';
import type { TileObjectInfo, TileStore } from './ports';

export interface ServeTileInput {
  /** Ruta después de /tiles/ (ya decodificada). */
  path: string;
  range?: string | null;
  ifNoneMatch?: string | null;
  /** HEAD: se resuelven estado y cabeceras sin leer el cuerpo. */
  headOnly?: boolean;
}

export type ServeTileResult =
  | { kind: 'not-found' }
  /** Rango de glifos que no se subió: el cliente recibe un PBF vacío. */
  | { kind: 'empty-glyphs'; file: TileFile }
  | { kind: 'not-modified'; file: TileFile; info: TileObjectInfo }
  | { kind: 'range-not-satisfiable'; file: TileFile; info: TileObjectInfo }
  | {
      kind: 'content';
      file: TileFile;
      info: TileObjectInfo;
      /** `null` = objeto completo (200); si no, 206 con este rango. */
      range: ByteRange | null;
      /** `null` solo en HEAD. */
      body: ReadableStream | null;
    };

export type ServeTile = (input: ServeTileInput) => Promise<ServeTileResult>;

/**
 * GET/HEAD /tiles/:file (HU-301). Aplica la lista blanca, If-None-Match y Range sobre el
 * almacén. Un nombre fuera de la lista blanca responde igual que uno inexistente.
 */
export function makeServeTile(deps: { store: TileStore }): ServeTile {
  return async ({ path, range, ifNoneMatch, headOnly = false }) => {
    const file = resolveTileFile(path);
    if (!file) return { kind: 'not-found' };

    const info = await deps.store.head(file.key);
    if (!info) return file.emptyIfMissing ? { kind: 'empty-glyphs', file } : { kind: 'not-found' };

    if (etagMatches(ifNoneMatch, info.etag)) return { kind: 'not-modified', file, info };

    const resolution = resolveRange(range, info.size);
    if (resolution.kind === 'unsatisfiable') return { kind: 'range-not-satisfiable', file, info };

    const partial = resolution.kind === 'partial' ? resolution.range : null;
    if (headOnly) return { kind: 'content', file, info, range: partial, body: null };

    const body = await deps.store.read(file.key, info, partial ?? { offset: 0, length: info.size });
    if (!body) return { kind: 'not-found' };
    return { kind: 'content', file, info, range: partial, body };
  };
}
