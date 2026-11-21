'use client';

import type { PolygonRings } from '@panter/contracts';
import {
  canDeleteVertex,
  describePolygon,
  MIN_VERTICES_MESSAGE,
  samePolygon,
  type VertexRef,
} from '../lib/polygon-edit';
import { formatLatLng } from '../lib/polygon-map';
import { polygonIssues, ringName } from '../lib/polygon-validation';
import type { PolygonEditing } from './polygon-layers';

export const EDIT_HELP =
  'Arrastra un vértice para moverlo. Haz clic en un punto pequeño (la mitad de un lado) para agregar un vértice. Para borrar uno, selecciónalo y pulsa «Borrar vértice» (o haz clic derecho sobre él). Cada borde necesita al menos 3 vértices.';

/**
 * Panel del polígono en edición (HU-304, HU-309): ayuda, botones, errores de la validación del
 * cliente (bloquean), advertencias (no bloquean) y la lista de vértices accesible con teclado.
 */
export function PolygonPanel({
  title,
  saved,
  editing,
  message,
  warnings = [],
  onSelect,
  onDelete,
  onInsertAfter,
  onReset,
}: {
  title: string;
  /** Polígono guardado (para «Deshacer cambios»); `null` si es nuevo. */
  saved: PolygonRings | null;
  editing: PolygonEditing;
  message: string | null;
  warnings?: readonly string[];
  onSelect: (ref: VertexRef) => void;
  onDelete: (ref: VertexRef) => void;
  onInsertAfter: (ref: VertexRef) => void;
  onReset: () => void;
}) {
  const issues = polygonIssues(editing.rings);
  const changed = saved !== null && !samePolygon(saved, editing.rings);
  const selected = editing.selected;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-stone-700">
      <p className="font-medium text-stone-900">{title}</p>
      <p>{EDIT_HELP}</p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!selected || !canDeleteVertex(editing.rings, selected.ring)}
          onClick={() => selected && onDelete(selected)}
          title={
            selected && !canDeleteVertex(editing.rings, selected.ring)
              ? MIN_VERTICES_MESSAGE
              : undefined
          }
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 font-medium hover:bg-stone-100 disabled:opacity-60"
        >
          Borrar vértice
        </button>
        {saved !== null ? (
          <button
            type="button"
            disabled={!changed}
            onClick={onReset}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 font-medium hover:bg-stone-100 disabled:opacity-60"
          >
            Deshacer cambios del polígono
          </button>
        ) : null}
      </div>
      <div aria-live="polite">
        {message ? <p className="text-red-700">{message}</p> : null}
        {issues.length > 0 ? (
          <ul className="list-disc pl-5 text-red-700">
            {issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        ) : null}
        {warnings.length > 0 ? (
          <ul className="list-disc pl-5 text-amber-900">
            {warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <details>
        <summary className="cursor-pointer">Vértices ({describePolygon(editing.rings)})</summary>
        <ol className="mt-2 flex flex-col gap-2">
          {editing.rings.map((ring, r) => (
            <li key={r}>
              <p className="font-medium">{ringName(r)}</p>
              <ol className="ml-4 flex list-decimal flex-col gap-1 font-mono text-xs">
                {ring.map((point, v) => {
                  const isSelected = selected?.ring === r && selected.vertex === v;
                  return (
                    <li key={v} className={isSelected ? 'font-bold text-amber-800' : undefined}>
                      <span>{formatLatLng(point)}</span>{' '}
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => onSelect({ ring: r, vertex: v })}
                        className="font-sans underline"
                      >
                        Seleccionar
                      </button>{' '}
                      <button
                        type="button"
                        onClick={() => onInsertAfter({ ring: r, vertex: v })}
                        className="font-sans underline"
                      >
                        Agregar después
                      </button>{' '}
                      <button
                        type="button"
                        disabled={!canDeleteVertex(editing.rings, r)}
                        onClick={() => onDelete({ ring: r, vertex: v })}
                        className="font-sans underline disabled:no-underline disabled:opacity-50"
                      >
                        Borrar
                      </button>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
