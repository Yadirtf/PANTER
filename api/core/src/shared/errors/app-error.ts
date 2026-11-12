/**
 * Error de aplicación con código estable, mensaje legible y estado HTTP sugerido.
 * Es agnóstico del dominio y de Hono: cualquier capa puede lanzarlo y el middleware de
 * errores lo traduce a `{ error: { code, message, details? } }`.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, options: { status?: number; details?: unknown } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? 400;
    this.details = options.details;
  }

  static notFound(message = 'Recurso no encontrado', details?: unknown): AppError {
    return new AppError('NOT_FOUND', message, { status: 404, details });
  }

  static validation(message = 'Datos de entrada inválidos', details?: unknown): AppError {
    return new AppError('VALIDATION_ERROR', message, { status: 400, details });
  }

  static internal(message = 'Error interno del servidor'): AppError {
    return new AppError('INTERNAL_ERROR', message, { status: 500 });
  }
}

/** Formato uniforme de error de la API. */
export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function toErrorBody(err: AppError): ErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details === undefined ? {} : { details: err.details }),
    },
  };
}
