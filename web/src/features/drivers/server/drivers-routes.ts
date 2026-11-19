import {
  AdminDriversQuerySchema,
  ApiErrorCode,
  DocumentReviewBodySchema,
  DocumentTypeSchema,
  ReasonBodySchema,
} from '@panter/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  crossSiteResponse,
  errorJson,
  isCrossSite,
  NO_STORE,
  readJson,
  validationResponse,
} from '@/features/auth/server/bff-http';
import type { RefreshFn } from '@/features/auth/server/session-call';
import { respondWithSession } from '@/features/auth/server/session-handler';
import { actionNeedsReason, type DriverAction } from '../lib/drivers';
import type { DriversApi } from './drivers-api';

/**
 * Route handlers BFF de la revisión de conductores (HU-204): `/api/admin/drivers/*`. Solo
 * reenvían a panter-api con el access token de la cookie; la API decide si la sesión es ADMIN.
 */
export interface DriversRouteDeps {
  drivers: DriversApi;
  refresh: RefreshFn;
}

const UserIdSchema = z.uuid();
const ACTIONS: readonly DriverAction[] = ['approve', 'reject', 'suspend', 'reinstate'];

function ok(value: unknown): NextResponse {
  return NextResponse.json(value ?? { ok: true }, { status: 200, headers: NO_STORE });
}

function notFound(): NextResponse {
  return errorJson(404, ApiErrorCode.NOT_FOUND, 'Solicitud de conductor no encontrada.');
}

/** GET /api/admin/drivers?status=&cursor= → GET /admin/drivers. */
export async function handleListDrivers(
  request: NextRequest,
  deps: DriversRouteDeps,
): Promise<NextResponse> {
  if (isCrossSite(request)) return crossSiteResponse();
  const params = request.nextUrl.searchParams;
  const query = AdminDriversQuerySchema.safeParse({
    status: params.get('status') || undefined,
    cursor: params.get('cursor') ?? undefined,
    limit: params.get('limit') ?? undefined,
  });
  if (!query.success) return validationResponse(query.error, 'Revisa el filtro.');
  return respondWithSession(
    request,
    deps.refresh,
    (token) => deps.drivers.list(token, query.data),
    ok,
  );
}

/** GET /api/admin/drivers/:userId/documents/:type/view-url: URL firmada nueva (la anterior venció). */
export async function handleDocumentViewUrl(
  request: NextRequest,
  userId: string,
  type: string,
  deps: DriversRouteDeps,
): Promise<NextResponse> {
  if (isCrossSite(request)) return crossSiteResponse();
  const docType = DocumentTypeSchema.safeParse(type);
  if (!UserIdSchema.safeParse(userId).success || !docType.success) return notFound();
  return respondWithSession(
    request,
    deps.refresh,
    (token) => deps.drivers.viewUrl(token, userId, docType.data),
    ok,
  );
}

/** POST /api/admin/drivers/:userId/documents/:type/review { decision, reason? }. */
export async function handleReviewDocument(
  request: NextRequest,
  userId: string,
  type: string,
  deps: DriversRouteDeps,
): Promise<NextResponse> {
  const body = await readJson(request, DocumentReviewBodySchema);
  if (!body.ok) return body.response;
  const docType = DocumentTypeSchema.safeParse(type);
  if (!UserIdSchema.safeParse(userId).success || !docType.success) return notFound();
  return respondWithSession(
    request,
    deps.refresh,
    (token) => deps.drivers.reviewDocument(token, userId, docType.data, body.data),
    ok,
  );
}

/** POST /api/admin/drivers/:userId/:action (approve, reject, suspend, reinstate). */
export async function handleDriverAction(
  request: NextRequest,
  userId: string,
  action: string,
  deps: DriversRouteDeps,
): Promise<NextResponse> {
  if (isCrossSite(request)) return crossSiteResponse();
  const known = ACTIONS.find((candidate) => candidate === action);
  if (!known || !UserIdSchema.safeParse(userId).success) return notFound();
  let reason: string | undefined;
  if (actionNeedsReason(known)) {
    const body = await readJson(request, ReasonBodySchema);
    if (!body.ok) return body.response;
    reason = body.data.reason;
  }
  return respondWithSession(
    request,
    deps.refresh,
    (token) => deps.drivers.act(token, userId, known, reason),
    ok,
  );
}
