/**
 * Cursor del listado de usuarios (orden `created_at DESC, id DESC`). Para el cliente es opaco:
 * base64url de `{"t":"<created_at ISO con microsegundos>","i":"<id>"}`. Guardar la fecha como
 * texto con microsegundos (no como Date de JS, que solo tiene milisegundos) hace la paginación
 * estable aunque varias cuentas se creen en el mismo milisegundo.
 */
export interface UserCursor {
  /** `created_at` en UTC con microsegundos, p. ej. `2026-11-18T12:00:00.123456Z`. */
  createdAt: string;
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

export function encodeUserCursor(cursor: UserCursor): string {
  return toBase64Url(JSON.stringify({ t: cursor.createdAt, i: cursor.id }));
}

/** Devuelve null si el cursor no es uno emitido por la API (o fue alterado). */
export function decodeUserCursor(value: string): UserCursor | null {
  try {
    const parsed = JSON.parse(fromBase64Url(value)) as { t?: unknown; i?: unknown };
    if (typeof parsed.t !== 'string' || typeof parsed.i !== 'string') return null;
    if (!ISO_MICROS.test(parsed.t) || !UUID.test(parsed.i)) return null;
    return { createdAt: parsed.t, id: parsed.i.toLowerCase() };
  } catch {
    return null;
  }
}
