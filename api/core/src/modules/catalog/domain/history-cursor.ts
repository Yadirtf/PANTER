/**
 * Cursor del historial del catálogo, barrios, veredas y lugares (orden `changed_at DESC, id
 * DESC`; el mismo formato que el de tarifas). Para el cliente es opaco: base64url de `{"t":"<changed_at ISO con microsegundos>","i":"<id>"}`. La
 * fecha va como texto con microsegundos para no perder precisión (Date de JS solo tiene ms).
 */
export interface HistoryCursor {
  changedAt: string;
  id: string;
}

const ISO_MICROS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toBase64Url(text: string): string {
  let binary = '';
  for (const b of new TextEncoder().encode(text)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return toBase64Url(JSON.stringify({ t: cursor.changedAt, i: cursor.id }));
}

/** null si el cursor no lo emitió la API (o fue alterado). */
export function decodeHistoryCursor(value: string): HistoryCursor | null {
  try {
    const parsed = JSON.parse(fromBase64Url(value)) as { t?: unknown; i?: unknown };
    if (typeof parsed.t !== 'string' || typeof parsed.i !== 'string') return null;
    if (!ISO_MICROS.test(parsed.t) || !UUID.test(parsed.i)) return null;
    return { changedAt: parsed.t, id: parsed.i.toLowerCase() };
  } catch {
    return null;
  }
}
