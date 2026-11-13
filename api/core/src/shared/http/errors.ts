import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import { AppError, toErrorBody } from '../errors/app-error';

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

/** Convierte los issues de Zod en `details` serializables y estables. */
export function zodIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

function respond(c: Context, err: AppError): Response {
  // Límites de frecuencia: `details.retryAfterSeconds` también va en la cabecera Retry-After.
  const retryAfter = (err.details as { retryAfterSeconds?: unknown } | undefined)
    ?.retryAfterSeconds;
  if (err.status === 429 && typeof retryAfter === 'number') {
    c.header('Retry-After', String(retryAfter));
  }
  return c.json(toErrorBody(err), err.status as ContentfulStatusCode);
}

/** Respuesta uniforme para un fallo de validación Zod (usada por el defaultHook de OpenAPI). */
export function validationErrorResponse(c: Context, error: ZodError): Response {
  return respond(c, AppError.validation('Datos de entrada inválidos', zodIssues(error)));
}

/** Middleware de errores: todo sale como `{ error: { code, message, details? } }`. */
export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) return respond(c, err);
  if (err instanceof ZodError) return validationErrorResponse(c, err);
  if (err instanceof HTTPException) {
    const code = err.status === 400 ? 'BAD_REQUEST' : `HTTP_${err.status}`;
    return respond(
      c,
      new AppError(code, err.message || 'Solicitud inválida', { status: err.status }),
    );
  }
  console.error('Error no controlado', err);
  return respond(c, AppError.internal());
};

export const notFoundHandler: NotFoundHandler = (c) =>
  respond(c, AppError.notFound(`Ruta no encontrada: ${c.req.method} ${c.req.path}`));
