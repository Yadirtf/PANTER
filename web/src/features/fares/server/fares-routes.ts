import { ApiErrorCode, FareRuleUpdateBodySchema, VehicleTypeSchema } from '@panter/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  crossSiteResponse,
  errorJson,
  isCrossSite,
  NO_STORE,
  readJson,
} from '@/features/auth/server/bff-http';
import type { RefreshFn } from '@/features/auth/server/session-call';
import { respondWithSession } from '@/features/auth/server/session-handler';
import { GeofenceUpdateBodySchema } from '../lib/fares';
import type { FaresApi } from './fares-api';

/**
 * Route handlers BFF de la edición de tarifas (HU-403): `/api/admin/fares/*`. Validan el cuerpo
 * con el mismo esquema que el formulario y reenvían a panter-api con el access token de la
 * cookie; la API decide si la sesión es ADMIN y vuelve a validar.
 */
export interface FaresRouteDeps {
  fares: FaresApi;
  refresh: RefreshFn;
}

function ok(value: unknown): NextResponse {
  return NextResponse.json(value ?? { ok: true }, { status: 200, headers: NO_STORE });
}

function notFound(): NextResponse {
  return errorJson(404, ApiErrorCode.NOT_FOUND, 'Tarifa o geocerca no encontrada.');
}

/** PUT /api/admin/fares/rules/:vehicleType → PUT /admin/fares/rules/:vehicleType. */
export async function handleUpdateRule(
  request: NextRequest,
  vehicleType: string,
  deps: FaresRouteDeps,
): Promise<NextResponse> {
  const body = await readJson(request, FareRuleUpdateBodySchema);
  if (!body.ok) return body.response;
  const type = VehicleTypeSchema.safeParse(vehicleType);
  if (!type.success) return notFound();
  return respondWithSession(
    request,
    deps.refresh,
    (token) => deps.fares.updateRule(token, type.data, body.data),
    ok,
  );
}

/** PUT /api/admin/fares/geofences/:id → PUT /admin/fares/geofences/:id. */
export async function handleUpdateGeofence(
  request: NextRequest,
  id: string,
  deps: FaresRouteDeps,
): Promise<NextResponse> {
  const body = await readJson(request, GeofenceUpdateBodySchema);
  if (!body.ok) return body.response;
  if (!z.uuid().safeParse(id).success) return notFound();
  return respondWithSession(
    request,
    deps.refresh,
    (token) => deps.fares.updateGeofence(token, id, body.data),
    ok,
  );
}

/** GET /api/admin/fares/history?cursor= → GET /admin/fares/history. */
export async function handleFareHistory(
  request: NextRequest,
  deps: FaresRouteDeps,
): Promise<NextResponse> {
  if (isCrossSite(request)) return crossSiteResponse();
  const cursor = request.nextUrl.searchParams.get('cursor')?.slice(0, 512) || undefined;
  return respondWithSession(
    request,
    deps.refresh,
    (token) => deps.fares.history(token, cursor),
    ok,
  );
}
