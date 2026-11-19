import { createRoute, z } from '@hono/zod-openapi';
import {
  DOCUMENT_MAX_BYTES,
  DocumentType,
  DocumentUploadUrlResponseSchema,
  DriverApplyBodySchema,
  DriverDocumentSchema,
  DriverProfileSchema,
  DriverRoutes,
} from '@panter/contracts';
import type { MiddlewareHandler } from 'hono';
import type { AppBindings, Env } from '../../../env';
import { createRouter } from '../../../shared/http/create-app';
import { ErrorSchema } from '../../../shared/http/schemas';
import { getActor } from '../../auth/http/require-auth';
import type { ApplyAsDriver, GetMyDriverProfile } from '../application/apply';
import {
  DOCUMENT_UPLOAD_PATH,
  type CreateUploadUrl,
  type UploadDocument,
} from '../application/documents';

/** Fábricas de los casos de uso del solicitante (raíz de composición). */
export interface DriverFactories {
  apply: (env: Env) => ApplyAsDriver;
  getMine: (env: Env) => GetMyDriverProfile;
  /** HU-202 */
  createUploadUrl: (env: Env) => CreateUploadUrl;
  uploadDocument: (env: Env) => UploadDocument;
}

export interface DriverGuards {
  requireAuth: () => MiddlewareHandler<AppBindings>;
  /** HU-109: los datos del vehículo y los documentos exigen el aviso de privacidad aceptado. */
  requireConsent: () => MiddlewareHandler<AppBindings>;
}

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });
const security = [{ bearerAuth: [] }];
const openapiPath = (path: string) => path.replace(/:(\w+)/g, '{$1}');

const TypeParam = z.enum(DocumentType).openapi({ param: { name: 'type', in: 'path' } });
// Content-Type y tamaño se validan en el caso de uso para responder DOCUMENT_TYPE_NOT_ALLOWED o
// DOCUMENT_TOO_LARGE en lugar de un VALIDATION_ERROR genérico (contrato: DocumentUploadUrlBodySchema).
const UploadUrlBodySchema = z.object({
  contentType: z.string().openapi({ example: 'image/jpeg' }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .openapi({ description: `Tamaño del archivo en bytes (máximo ${DOCUMENT_MAX_BYTES}).` }),
});

/**
 * Rutas del solicitante: POST /drivers/apply y GET /drivers/me (HU-201); URL firmada y PUT de
 * documentos (HU-202).
 */
export function driverRoutes(build: DriverFactories, guards: DriverGuards) {
  const applyRoute = createRoute({
    method: 'post',
    path: DriverRoutes.APPLY,
    tags: ['drivers'],
    summary: 'Solicitar ser conductor',
    description:
      'Registra el vehículo y crea el perfil en PENDING (placa colombiana: ABC123 para carros, ' +
      'ABC12D para motos). No otorga el rol DRIVER: llega cuando un ADMIN aprueba. Si la ' +
      'solicitud fue rechazada, la reenvía con el vehículo corregido y vuelve a PENDING.',
    security,
    middleware: [guards.requireAuth(), guards.requireConsent()] as const,
    request: { body: { required: true, content: json(DriverApplyBodySchema) } },
    responses: {
      201: { description: 'Perfil de conductor', content: json(DriverProfileSchema) },
      400: error('VALIDATION_ERROR: vehículo o placa inválidos'),
      401: error('UNAUTHENTICATED o TOKEN_EXPIRED'),
      403: error('CONSENT_REQUIRED'),
      409: error('DRIVER_ALREADY_APPLIED o PLATE_ALREADY_REGISTERED'),
    },
  });

  const meRoute = createRoute({
    method: 'get',
    path: DriverRoutes.ME,
    tags: ['drivers'],
    summary: 'Mi perfil de conductor',
    description:
      'Estado de la solicitud, vehículo, documentos subidos y los que faltan o hay que corregir.',
    security,
    middleware: [guards.requireAuth()] as const,
    responses: {
      200: { description: 'Perfil de conductor', content: json(DriverProfileSchema) },
      401: error('UNAUTHENTICATED o TOKEN_EXPIRED'),
      404: error('DRIVER_NOT_APPLIED'),
    },
  });

  const uploadUrlRoute = createRoute({
    method: 'post',
    path: openapiPath(DriverRoutes.DOCUMENT_UPLOAD_URL),
    tags: ['drivers'],
    summary: 'URL firmada para subir un documento',
    description:
      'Devuelve una URL de este Worker, firmada con HMAC y válida 10 minutos y una sola vez, ' +
      'para subir la foto con PUT y el mismo Content-Type (JPG, PNG o WEBP; máx. 8 MB). Solo con ' +
      'la solicitud PENDING o REJECTED. Los archivos nunca son públicos.',
    security,
    middleware: [guards.requireAuth(), guards.requireConsent()] as const,
    request: {
      params: z.object({ type: TypeParam }),
      body: { required: true, content: json(UploadUrlBodySchema) },
    },
    responses: {
      200: { description: 'URL de subida', content: json(DocumentUploadUrlResponseSchema) },
      400: error('VALIDATION_ERROR: tipo de documento o tamaño inválidos'),
      401: error('UNAUTHENTICATED o TOKEN_EXPIRED'),
      403: error('CONSENT_REQUIRED'),
      404: error('DRIVER_NOT_APPLIED'),
      409: error('INVALID_DRIVER_TRANSITION: la solicitud ya fue aprobada o suspendida'),
      413: error('DOCUMENT_TOO_LARGE'),
      415: error('DOCUMENT_TYPE_NOT_ALLOWED'),
    },
  });

  const uploadRoute = createRoute({
    method: 'put',
    path: DOCUMENT_UPLOAD_PATH,
    tags: ['drivers'],
    summary: 'Subir el archivo a la URL firmada',
    description:
      'Sin Authorization: la firma del token es la autorización. Cuerpo: los bytes de la imagen ' +
      'con el Content-Type firmado. Se verifican la firma, el vencimiento, el tamaño (aunque ' +
      'Content-Length mienta) y los magic bytes. Queda en SUBMITTED.',
    request: { query: z.object({ token: z.string().optional() }) },
    responses: {
      200: { description: 'Documento guardado', content: json(DriverDocumentSchema) },
      403: error('UPLOAD_URL_INVALID: firma inválida, vencida o ya usada'),
      404: error('DRIVER_NOT_APPLIED'),
      409: error('INVALID_DRIVER_TRANSITION: la solicitud ya fue aprobada o suspendida'),
      413: error('DOCUMENT_TOO_LARGE'),
      415: error('DOCUMENT_TYPE_NOT_ALLOWED: Content-Type o contenido no coinciden'),
    },
  });

  return createRouter()
    .openapi(uploadUrlRoute, async (c) => {
      const { type } = c.req.valid('param');
      const body = c.req.valid('json');
      const result = await build.createUploadUrl(c.env)(getActor(c), {
        type,
        ...body,
        origin: new URL(c.req.url).origin,
      });
      c.header('Cache-Control', 'no-store');
      return c.json(result, 200);
    })
    .openapi(uploadRoute, async (c) => {
      const doc = await build.uploadDocument(c.env)({
        token: c.req.valid('query').token,
        contentType: c.req.header('content-type'),
        contentLength: c.req.header('content-length'),
        body: c.req.raw.body,
      });
      c.header('Cache-Control', 'no-store');
      return c.json(doc, 200);
    })
    .openapi(applyRoute, async (c) => {
      const profile = await build.apply(c.env)(getActor(c), c.req.valid('json'));
      c.header('Cache-Control', 'no-store');
      return c.json(profile, 201);
    })
    .openapi(meRoute, async (c) => {
      const profile = await build.getMine(c.env)(getActor(c));
      c.header('Cache-Control', 'no-store');
      return c.json(profile, 200);
    });
}
