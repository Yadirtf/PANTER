'use client';

import type { DocumentType } from '@panter/contracts';
import { useState } from 'react';
import { fetchDocumentViewUrl } from '../api/drivers-client';

/** Reintentos automáticos seguidos cuando la imagen no carga (URL vencida). */
export const MAX_AUTO_RENEWALS = 2;

/**
 * Foto del documento con la URL firmada de lectura que pidió el servidor al renderizar. La URL
 * vence (DOCUMENT_URL_TTL_SECONDS): si la imagen falla al cargar se pide una nueva por el BFF.
 */
export function DocumentImage({
  userId,
  type,
  label,
  initialUrl,
}: {
  userId: string;
  type: DocumentType;
  label: string;
  initialUrl: string | null;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [renewals, setRenewals] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(initialUrl === null);

  async function renew() {
    setLoading(true);
    try {
      const fresh = await fetchDocumentViewUrl(userId, type);
      setUrl(fresh.url);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  function onError() {
    if (renewals >= MAX_AUTO_RENEWALS) {
      setFailed(true);
      return;
    }
    setRenewals((n) => n + 1);
    void renew();
  }

  if (failed || !url) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-center text-sm text-stone-600">
        <p>No pudimos mostrar la imagen. El enlace pudo vencer.</p>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setRenewals(0);
            void renew();
          }}
          className="rounded-md border border-stone-300 px-3 py-1 font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
        >
          {loading ? 'Cargando…' : 'Volver a cargar'}
        </button>
      </div>
    );
  }

  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="block">
      {/* <img> y no next/image: la URL firmada es externa y de corta vida (no se optimiza). */}
      <img
        src={url}
        alt={`Foto: ${label}`}
        onError={onError}
        referrerPolicy="no-referrer"
        className="h-48 w-full rounded-lg border border-stone-200 bg-stone-100 object-contain"
      />
    </a>
  );
}
