import { z } from '@hono/zod-openapi';

/** Esquema OpenAPI del formato de error uniforme. */
export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
      message: z.string().openapi({ example: 'Datos de entrada inválidos' }),
      details: z.unknown().optional(),
    }),
  })
  .openapi('Error');
