import { createRoute, z } from '@hono/zod-openapi';
import {
  AdminDriverRoutes,
  AdminDriverSchema,
  AdminDriversQuerySchema,
  AdminDriversResponseSchema,
  DocumentReviewBodySchema,
  DocumentType,
  DocumentViewUrlResponseSchema,
  ReasonBodySchema,
  Role,
} from '@panter/contracts';
import type { MiddlewareHandler } from 'hono';
import type { AppBindings, Env } from '../../../env';
import { createRouter } from '../../../shared/http/create-app';
import { ErrorSchema } from '../../../shared/http/schemas';
import { requireRole } from '../../auth/http/authorize';
import { getActor } from '../../auth/http/require-auth';
import {
  DOCUMENT_VIEW_PATH,
  type CreateViewUrl,
  type DecideDriver,
  type GetDriver,
  type ListDrivers,
  type ReadDocument,
  type ReviewDocument,
} from '../application/admin-review';

/** Fábricas de la revisión por ADMIN (HU-204). */
export interface AdminDriverFactories {
  list: (env: Env) => ListDrivers;
  detail: (env: Env) => GetDriver;
  viewUrl: (env: Env) => CreateViewUrl;
  readDocument: (env: Env) => ReadDocument;
  reviewDocument: (env: Env) => ReviewDocument;
  approve: (env: Env) => DecideDriver;
  reject: (env: Env) => DecideDriver;
  suspend: (env: Env) => DecideDriver;
  reinstate: (env: Env) => DecideDriver;
}

const json = <T>(schema: T) => ({ 'application/json': { schema } });
const error = (description: string) => ({ description, content: json(ErrorSchema) });
const security = [{ bearerAuth: [] }];
const openapiPath = (path: string) => path.replace(/:(\w+)/g, '{$1}');

const UserIdParam = z.uuid().openapi({ param: { name: 'userId', in: 'path' } });
const TypeParam = z.enum(DocumentType).openapi({ param: { name: 'type', in: 'path' } });

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const commonErrors = {
  401: error('UNAUTHENTICATED o TOKEN_EXPIRED'),
  403: error('FORBIDDEN: se necesita el rol ADMIN'),
  404: error('NOT_FOUND: no existe la solicitud'),
};

/**
 * Revisión de conductores por ADMIN (HU-204). Todas las rutas de AdminDriverRoutes exigen
 * `requireAuth()` + `requireRole(ADMIN)` y cada decisión vuelve a comprobar en la base de datos
 * que el actor sigue siendo ADMIN. El GET firmado de lectura no lleva Bearer: lo carga el
 * navegador en un <img>; la firma (5 min) es la autorización.
 */
export function adminDriverRoutes(
  build: AdminDriverFactories,
  requireAuth: () => MiddlewareHandler<AppBindings>,
) {
  const guard = (): MiddlewareHandler<AppBindings>[] => [requireAuth(), requireRole(Role.ADMIN)];
  const userParams = z.object({ userId: UserIdParam });
  const docParams = z.object({ userId: UserIdParam, type: TypeParam });

  const listRoute = createRoute({
    method: 'get',
    path: AdminDriverRoutes.LIST,
    tags: ['admin-drivers'],
    summary: 'Solicitudes de conductor',
    description:
      'Filtro por estado y paginación por cursor opaco, de la más antigua a la más reciente ' +
      '(applied_at, user_id): primero quien lleva más tiempo esperando.',
    security,
    middleware: guard(),
    request: { query: AdminDriversQuerySchema },
    responses: {
      200: { description: 'Página de solicitudes', content: json(AdminDriversResponseSchema) },
      400: error('VALIDATION_ERROR: estado, límite o cursor inválidos'),
      ...commonErrors,
    },
  });

  const detailRoute = createRoute({
    method: 'get',
    path: openapiPath(AdminDriverRoutes.DETAIL),
    tags: ['admin-drivers'],
    summary: 'Detalle de una solicitud',
    description: 'Perfil, vehículo, documentos y correo del ADMIN que tomó la última decisión.',
    security,
    middleware: guard(),
    request: { params: userParams },
    responses: {
      200: { description: 'Solicitud', content: json(AdminDriverSchema) },
      400: error('VALIDATION_ERROR'),
      ...commonErrors,
    },
  });

  const viewUrlRoute = createRoute({
    method: 'get',
    path: openapiPath(AdminDriverRoutes.DOCUMENT_VIEW_URL),
    tags: ['admin-drivers'],
    summary: 'URL firmada para ver un documento',
    description: 'GET firmado de este Worker, válido 5 minutos, que lee la imagen de R2 sin caché.',
    security,
    middleware: guard(),
    request: { params: docParams },
    responses: {
      200: { description: 'URL de lectura', content: json(DocumentViewUrlResponseSchema) },
      400: error('VALIDATION_ERROR'),
      ...commonErrors,
    },
  });

  const viewRoute = createRoute({
    method: 'get',
    path: DOCUMENT_VIEW_PATH,
    tags: ['admin-drivers'],
    summary: 'Ver el documento (URL firmada)',
    description:
      'Devuelve la imagen desde R2 con Cache-Control: private, no-store y Content-Disposition ' +
      'inline. Sin Authorization: la firma es la autorización.',
    request: { query: z.object({ token: z.string().optional() }) },
    responses: {
      200: { description: 'Imagen JPG, PNG o WEBP' },
      403: error('UPLOAD_URL_INVALID: firma inválida o vencida'),
      404: error('NOT_FOUND: el archivo ya no existe'),
    },
  });

  const reviewRoute = createRoute({
    method: 'post',
    path: openapiPath(AdminDriverRoutes.DOCUMENT_REVIEW),
    tags: ['admin-drivers'],
    summary: 'Revisar un documento',
    description:
      'APPROVED, o REJECTED con motivo (5 a 500 caracteres). Solicitud PENDING o REJECTED.',
    security,
    middleware: guard(),
    request: {
      params: docParams,
      body: { required: true, content: json(DocumentReviewBodySchema) },
    },
    responses: {
      200: { description: 'Solicitud actualizada', content: json(AdminDriverSchema) },
      400: error('VALIDATION_ERROR: decisión o motivo inválidos'),
      ...commonErrors,
      409: error('INVALID_DRIVER_TRANSITION: solicitud aprobada o suspendida'),
    },
  });

  const decisionResponses = (conflicts: string) => ({
    200: { description: 'Solicitud actualizada', content: json(AdminDriverSchema) },
    400: error('VALIDATION_ERROR'),
    ...commonErrors,
    409: error(conflicts),
  });
  const plainDecision = (path: string, summary: string, description: string, conflicts: string) =>
    createRoute({
      method: 'post',
      path: openapiPath(path),
      tags: ['admin-drivers'],
      summary,
      description,
      security,
      middleware: guard(),
      request: { params: userParams },
      responses: decisionResponses(conflicts),
    });
  const reasonDecision = (path: string, summary: string, description: string) =>
    createRoute({
      method: 'post',
      path: openapiPath(path),
      tags: ['admin-drivers'],
      summary,
      description,
      security,
      middleware: guard(),
      request: { params: userParams, body: { required: true, content: json(ReasonBodySchema) } },
      responses: decisionResponses('INVALID_DRIVER_TRANSITION'),
    });

  const approveRoute = plainDecision(
    AdminDriverRoutes.APPROVE,
    'Aprobar conductor',
    'Desde PENDING (o REJECTED ya corregida) y con los 5 documentos APPROVED. En una sola ' +
      'sentencia: APPROVED, rol DRIVER (granted_by y role_audit). Publica DriverApproved en la ' +
      'cola EVENTS.',
    'DOCUMENTS_INCOMPLETE o INVALID_DRIVER_TRANSITION',
  );
  const rejectRoute = reasonDecision(
    AdminDriverRoutes.REJECT,
    'Rechazar solicitud',
    'PENDING → REJECTED con motivo. El solicitante corrige y reenvía.',
  );
  const suspendRoute = reasonDecision(
    AdminDriverRoutes.SUSPEND,
    'Suspender conductor',
    'APPROVED → SUSPENDED con motivo y availability OFFLINE. Conserva el rol DRIVER, pero el ' +
      'modo conductor queda bloqueado.',
  );
  const reinstateRoute = plainDecision(
    AdminDriverRoutes.REINSTATE,
    'Reactivar conductor',
    'SUSPENDED → APPROVED.',
    'INVALID_DRIVER_TRANSITION',
  );

  const noStore = 'no-store';

  return createRouter()
    .openapi(listRoute, async (c) => {
      const page = await build.list(c.env)(c.req.valid('query'));
      c.header('Cache-Control', noStore);
      return c.json(page, 200);
    })
    .openapi(detailRoute, async (c) => {
      const driver = await build.detail(c.env)(c.req.valid('param').userId);
      c.header('Cache-Control', noStore);
      return c.json(driver, 200);
    })
    .openapi(viewUrlRoute, async (c) => {
      const { userId, type } = c.req.valid('param');
      const view = await build.viewUrl(c.env)({ userId, type, origin: new URL(c.req.url).origin });
      c.header('Cache-Control', noStore);
      return c.json(view, 200);
    })
    .openapi(viewRoute, async (c) => {
      const doc = await build.readDocument(c.env)(c.req.valid('query').token);
      const ext = EXTENSIONS[doc.contentType] ?? 'bin';
      return new Response(doc.body, {
        status: 200,
        headers: {
          'Content-Type': doc.contentType,
          'Content-Length': String(doc.size),
          'Content-Disposition': `inline; filename="${doc.type.toLowerCase()}.${ext}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          // El token va en la URL: que no viaje en el Referer ni se ejecute nada.
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      });
    })
    .openapi(reviewRoute, async (c) => {
      const { userId, type } = c.req.valid('param');
      const driver = await build.reviewDocument(c.env)(getActor(c), {
        userId,
        type,
        body: c.req.valid('json'),
      });
      return c.json(driver, 200);
    })
    .openapi(approveRoute, async (c) => {
      const driver = await build.approve(c.env)(getActor(c), c.req.valid('param'));
      return c.json(driver, 200);
    })
    .openapi(rejectRoute, async (c) => {
      const { reason } = c.req.valid('json');
      const driver = await build.reject(c.env)(getActor(c), { ...c.req.valid('param'), reason });
      return c.json(driver, 200);
    })
    .openapi(suspendRoute, async (c) => {
      const { reason } = c.req.valid('json');
      const driver = await build.suspend(c.env)(getActor(c), { ...c.req.valid('param'), reason });
      return c.json(driver, 200);
    })
    .openapi(reinstateRoute, async (c) => {
      const driver = await build.reinstate(c.env)(getActor(c), c.req.valid('param'));
      return c.json(driver, 200);
    });
}
