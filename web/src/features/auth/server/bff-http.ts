import { ApiErrorCode, type ApiErrorBody } from '@panter/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import { ClientErrorCode, toApiError } from '@/shared/api/errors';

/** Utilidades comunes de los route handlers BFF (`/api/session/*`, `/api/admin/*`). */
export const NO_STORE = { 'cache-control': 'no-store' };

export function errorResponse(status: number, body: ApiErrorBody): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function errorJson(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse {
  return errorResponse(status, { error: { code, message, ...(details ? { details } : {}) } });
}

/** Convierte un fallo de la API en la misma respuesta de error para el navegador. */
export function fromApiFailure(value: unknown): NextResponse {
  const apiError = toApiError(value);
  if (apiError.status === 0 || apiError.code === ClientErrorCode.INVALID_RESPONSE) {
    return errorJson(
      502,
      ClientErrorCode.NETWORK_ERROR,
      'No pudimos conectar con PANTER. Intenta de nuevo en un momento.',
    );
  }
  const status = apiError.status >= 400 ? apiError.status : 502;
  return errorJson(status, apiError.code, apiError.message, apiError.details);
}

/**
 * Rechaza peticiones de otros orígenes (las cookies ya son SameSite=Lax; esto es una capa más).
 * Se compara contra el encabezado Host y no contra `request.url`, que en el Worker de OpenNext
 * no siempre conserva el host público.
 */
export function isCrossSite(request: NextRequest): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return true;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('host');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export function crossSiteResponse(): NextResponse {
  return errorJson(403, ApiErrorCode.FORBIDDEN, 'Origen no permitido.');
}

export function validationResponse(error: z.ZodError, message: string): NextResponse {
  return errorJson(400, ApiErrorCode.VALIDATION_ERROR, message, {
    issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  });
}

/** Lee y valida el cuerpo JSON de una petición del mismo sitio. */
export async function readJson<S extends z.ZodType>(
  request: NextRequest,
  schema: S,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: NextResponse }> {
  if (isCrossSite(request)) return { ok: false, response: crossSiteResponse() };
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: validationResponse(parsed.error, 'Revisa los datos e intenta de nuevo.'),
    };
  }
  return { ok: true, data: parsed.data };
}
