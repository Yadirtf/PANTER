// Formatos del estimado en español de Colombia, sin Intl (igual en Hermes y en Node).

const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Pesos colombianos enteros: 19500 → "$ 19.500"; -300 → "-$ 300". */
export function formatCop(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$ ${thousands(Math.abs(rounded))}`;
}

/** 850 → "850 m"; 3240 → "3,2 km"; 12000 → "12 km". */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  const text = km >= 100 ? km.toFixed(0) : km.toFixed(1).replace(/\.0$/, '');
  return `${text.replace('.', ',')} km`;
}

/** 420 → "7 min"; 30 → "1 min"; 3900 → "1 h 5 min". */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
