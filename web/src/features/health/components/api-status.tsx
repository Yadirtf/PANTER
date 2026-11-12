'use client';

import { publicEnv } from '@/shared/config/env';
import { useHealth } from '../hooks/use-health';

/** Indicador del estado de la API (ejemplo de llamada tipada a GET /health). */
export function ApiStatus() {
  const { data, error, isPending } = useHealth();

  let label = 'Comprobando API…';
  let tone = 'bg-amber-400';
  if (error) {
    label = `API no disponible (${error.code})`;
    tone = 'bg-red-500';
  } else if (!isPending && data) {
    label = `API: ${data.status}`;
    tone = 'bg-emerald-500';
  }

  return (
    <p
      className="inline-flex items-center gap-2 text-sm text-stone-600"
      title={publicEnv.NEXT_PUBLIC_API_URL}
    >
      <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden="true" />
      <span role="status">{label}</span>
    </p>
  );
}
