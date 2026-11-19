/**
 * Cursor del listado de solicitudes (HU-204). Orden `applied_at ASC, user_id ASC`: la cola de
 * revisión atiende primero a quien lleva más tiempo esperando (índice
 * driver_profiles_status_applied_idx). Para el cliente es opaco: base64url de
 * `{"a":"<applied_at ISO con microsegundos>","u":"<user_id>"}`. Con microsegundos (no con la
 * fecha de JS, que solo tiene milisegundos) la paginación no salta ni repite filas.
 */
export interface DriverCursor {
  /** `applied_at` en UTC con microsegundos, p. ej. `2026-11-18T12:00:00.123456Z`. */
  appliedAt: string;
  userId: string;
}

const ISO_MICROS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function encodeDriverCursor(cursor: DriverCursor): string {
  // Solo ASCII (fecha ISO y UUID): btoa directo.
  return toBase64Url(JSON.stringify({ a: cursor.appliedAt, u: cursor.userId }));
}

/** Devuelve null si el cursor no es uno emitido por la API (o fue alterado). */
export function decodeDriverCursor(value: string): DriverCursor | null {
  try {
    const parsed = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/'))) as {
      a?: unknown;
      u?: unknown;
    };
    if (typeof parsed.a !== 'string' || typeof parsed.u !== 'string') return null;
    if (!ISO_MICROS.test(parsed.a) || !UUID.test(parsed.u)) return null;
    return { appliedAt: parsed.a, userId: parsed.u.toLowerCase() };
  } catch {
    return null;
  }
}
