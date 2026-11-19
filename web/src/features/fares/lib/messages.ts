import { ApiErrorCode } from '@panter/contracts';
import { ADMIN_ERROR_MESSAGES } from '@/features/admin/lib/messages';

/** Mensajes de la edición de tarifas (HU-403) para cada código de error. */
export const FARE_ERROR_MESSAGES: Record<string, string> = {
  ...ADMIN_ERROR_MESSAGES,
  [ApiErrorCode.FARE_RULE_NOT_FOUND]:
    'No existe una tarifa para ese tipo de vehículo. Recarga la página.',
  [ApiErrorCode.NOT_FOUND]:
    'No encontramos esa tarifa o geocerca. Puede que ya no exista; recarga la página.',
  [ApiErrorCode.FORBIDDEN]:
    'No tienes permiso para editar tarifas. Esta sección es solo para administradores.',
  [ApiErrorCode.VALIDATION_ERROR]:
    'Algún valor no es válido. Revisa los montos (entre $ 0 y $ 1.000.000), las horas y el redondeo.',
};

const FALLBACK_MESSAGE = 'No pudimos guardar los cambios. Intenta de nuevo.';

export function fareErrorMessage(code: string): string {
  return FARE_ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE;
}

interface PathIssue {
  path: string;
  message: string;
}

function isPolygonIssue(issue: unknown): issue is PathIssue {
  if (!issue || typeof issue !== 'object') return false;
  const { path, message } = issue as { path?: unknown; message?: unknown };
  return typeof path === 'string' && path.startsWith('polygon') && typeof message === 'string';
}

/**
 * Mensaje de la API cuando rechaza el polígono de una geocerca (400 VALIDATION_ERROR con
 * `details` en `polygon…`, p. ej. `ST_IsValid` de PostGIS): se muestra tal cual, con el detalle
 * de cada problema. `null` si el error no es del polígono.
 */
export function polygonRejectionMessage(error: {
  code: string;
  message: string;
  details?: unknown;
}): string | null {
  if (error.code !== ApiErrorCode.VALIDATION_ERROR) return null;
  const raw = error.details;
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { issues?: unknown }).issues)
      ? (raw as { issues: unknown[] }).issues
      : [];
  const issues = list.filter(isPolygonIssue);
  if (issues.length === 0) return null;
  const details = [...new Set(issues.map((issue) => issue.message))].join(' ');
  return `${error.message} ${details}`.trim();
}
