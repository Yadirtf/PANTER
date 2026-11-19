// Vigencia de la cotización (validUntil, 10 minutos en la API).

export interface QuoteValidity {
  expired: boolean;
  remainingMs: number;
  /** "Precio válido por 9:05" o "El precio venció". */
  label: string;
}

export function quoteValidity(validUntil: string, now: Date): QuoteValidity {
  const remainingMs = Math.max(0, Date.parse(validUntil) - now.getTime());
  if (remainingMs === 0) return { expired: true, remainingMs, label: 'El precio venció' };
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return { expired: false, remainingMs, label: `Precio válido por ${minutes}:${seconds}` };
}
