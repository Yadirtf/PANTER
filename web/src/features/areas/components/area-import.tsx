'use client';

import {
  AREA_IMPORT_MAX_FEATURES,
  AREA_KIND_LABELS,
  type AreaImportResult,
  type AreaKind,
} from '@panter/contracts';
import { useState } from 'react';
import { handleAdminFailure } from '@/features/admin/lib/admin-failure';
import { importAreas } from '@/features/catalog/api/catalog-client';
import { catalogFailureMessage } from '@/features/catalog/lib/messages';
import { inputClass } from '@/features/fares/components/form-fields';
import type { MapShape } from '@/features/geo-editor/lib/polygon-map';
import { toApiError } from '@/shared/api/errors';
import { ADMIN_AREAS_PATH, AREA_KINDS } from '../lib/areas';
import {
  AREA_IMPORT_MAX_BYTES,
  defaultImportSource,
  importBody,
  parseImportFile,
  previewShapes,
  previewSummary,
  type ImportOptions,
  type ParsedImportFile,
} from '../lib/geojson-import';

export const IMPORT_HELP = `Sube un archivo GeoJSON (FeatureCollection de polígonos, hasta ${AREA_IMPORT_MAX_FEATURES} y ${AREA_IMPORT_MAX_BYTES / (1024 * 1024)} MB). Primero verás una vista previa en el mapa; nada se guarda hasta que confirmes.`;

/**
 * Importar barrios y veredas desde GeoJSON (HU-309): archivo validado en el navegador, elección
 * de las propiedades de nombre y tipo, vista previa con dryRun (válidos en el mapa, errores por
 * índice, reemplazos marcados) y confirmación.
 */
export function AreaImport({
  onPreview,
  onImported,
  onClose,
}: {
  onPreview: (shapes: MapShape[]) => void;
  onImported: (saved: number) => void;
  onClose: () => void;
}) {
  const [file, setFile] = useState<(ParsedImportFile & { name: string }) | null>(null);
  const [options, setOptions] = useState<ImportOptions>({
    nameProperty: '',
    kindProperty: '',
    defaultKind: 'BARRIO',
    source: '',
  });
  const [preview, setPreview] = useState<AreaImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(next: Partial<ImportOptions>) {
    setOptions((current) => ({ ...current, ...next }));
    setPreview(null);
    onPreview([]);
  }

  async function readFile(selected: File | undefined) {
    setError(null);
    setPreview(null);
    onPreview([]);
    setFile(null);
    if (!selected) return;
    // El tamaño se revisa antes de leer: un archivo enorme no se carga en memoria.
    const parsed =
      selected.size > AREA_IMPORT_MAX_BYTES
        ? parseImportFile('', selected.size)
        : parseImportFile(await selected.text(), selected.size);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setFile({ ...parsed, name: selected.name });
    setOptions((current) => ({
      ...current,
      nameProperty: parsed.suggestedNameProperty ?? parsed.propertyKeys[0] ?? '',
      kindProperty: parsed.suggestedKindProperty ?? '',
      source: defaultImportSource(selected.name),
    }));
  }

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importAreas(importBody(file.geojson, options, dryRun));
      if (dryRun) {
        setPreview(result);
        onPreview(previewShapes(result));
      } else {
        onPreview([]);
        onImported(result.saved);
      }
    } catch (failure) {
      handleAdminFailure(
        failure,
        ADMIN_AREAS_PATH,
        () => catalogFailureMessage(toApiError(failure)),
        setError,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="importar-geojson"
      className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="importar-geojson" className="font-semibold text-stone-900">
            Importar GeoJSON
          </h3>
          <p className="text-sm text-stone-600">{IMPORT_HELP}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            onPreview([]);
            onClose();
          }}
          className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
        >
          Cerrar
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="importar-archivo" className="text-sm font-medium text-stone-700">
          Archivo (.geojson o .json)
        </label>
        <input
          id="importar-archivo"
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          onChange={(event) => void readFile(event.target.files?.[0])}
          className="text-sm"
        />
      </div>

      {file ? (
        <>
          <p className="text-sm text-stone-700">
            {file.name}: {file.featureCount === 1 ? '1 polígono' : `${file.featureCount} polígonos`}
            .
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="importar-nombre" className="text-sm font-medium text-stone-700">
                Propiedad con el nombre
              </label>
              <select
                id="importar-nombre"
                value={options.nameProperty}
                onChange={(event) => update({ nameProperty: event.target.value })}
                className={inputClass}
              >
                {file.propertyKeys.length === 0 ? (
                  <option value="">(el archivo no tiene propiedades de texto)</option>
                ) : null}
                {file.propertyKeys.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="importar-tipo" className="text-sm font-medium text-stone-700">
                Propiedad con el tipo (Barrio o Vereda)
              </label>
              <select
                id="importar-tipo"
                value={options.kindProperty}
                onChange={(event) => update({ kindProperty: event.target.value })}
                className={inputClass}
              >
                <option value="">Ninguna: todos del tipo por defecto</option>
                {file.propertyKeys.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="importar-tipo-defecto" className="text-sm font-medium text-stone-700">
                Tipo por defecto
              </label>
              <select
                id="importar-tipo-defecto"
                value={options.defaultKind}
                onChange={(event) => update({ defaultKind: event.target.value as AreaKind })}
                className={inputClass}
              >
                {AREA_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {AREA_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="importar-fuente" className="text-sm font-medium text-stone-700">
                Fuente
              </label>
              <input
                id="importar-fuente"
                value={options.source}
                maxLength={200}
                onChange={(event) => update({ source: event.target.value })}
                className={inputClass}
              />
            </div>
          </div>
          {preview ? null : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void send(true)}
              className="self-start rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {busy ? 'Revisando…' : 'Previsualizar'}
            </button>
          )}
        </>
      ) : null}

      {preview ? (
        <div aria-live="polite" className="flex flex-col gap-3">
          <p className="font-medium text-stone-900">Vista previa: {previewSummary(preview)}</p>
          {preview.valid.length > 0 ? (
            <details open={preview.valid.length <= 10}>
              <summary className="cursor-pointer text-sm">Polígonos válidos (en el mapa)</summary>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {preview.valid.map((item) => (
                  <li key={item.index}>
                    #{item.index + 1} · {AREA_KIND_LABELS[item.kind]} {item.name}
                    {item.replacesExisting ? (
                      <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-950">
                        Reemplaza al existente
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {preview.errors.length > 0 ? (
            <div>
              <p className="text-sm font-medium text-red-800">Con errores (no se importan):</p>
              <ul className="mt-1 flex flex-col gap-1 text-sm text-red-800">
                {preview.errors.map((item) => (
                  <li key={item.index}>
                    #{item.index + 1}
                    {item.name ? ` · ${item.name}` : ''}: {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy || preview.valid.length === 0}
              onClick={() => void send(false)}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {busy ? 'Importando…' : `Confirmar importación (${preview.valid.length})`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                onPreview([]);
              }}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </section>
  );
}
