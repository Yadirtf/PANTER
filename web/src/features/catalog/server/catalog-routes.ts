import {
  ApiErrorCode,
  AreaCreateBodySchema,
  AreaImportBodySchema,
  AreaUpdateBodySchema,
  type Area,
} from '@panter/contracts';
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
import { isApiError } from '@/shared/api/errors';
import { AREA_DETAILS_MAX_IDS } from '../lib/limits';
import type { CatalogApi } from './catalog-api';

/**
 * Route handlers BFF del catálogo geográfico (E15): `/api/admin/areas/*`. Validan el cuerpo con
 * los esquemas de contracts y reenvían a panter-api con el access token de la cookie (Bearer, de
 * servidor a servidor). La API decide si la sesión es ADMIN y vuelve a validar.
 */
export interface CatalogRouteDeps {
  catalog: CatalogApi;
  refresh: RefreshFn;
}

export interface AreaDetailsResponse {
  items: Area[];
  /** Ids que la API ya no tiene (borrados o sin acceso). */
  missing: string[];
}

function ok(value: unknown): NextResponse {
  return NextResponse.json(value ?? { ok: true }, { status: 200, headers: NO_STORE });
}

function notFound(): NextResponse {
  return errorJson(404, ApiErrorCode.NOT_FOUND, 'Barrio o vereda no encontrado.');
}

const isUuid = (id: string) => z.uuid().safeParse(id).success;

/** Ids de `?ids=a,b,c`: UUID válidos, sin repetir; `null` si la lista no sirve. */
export function parseIds(raw: string | null): string[] | null {
  if (!raw) return null;
  const ids = [...new Set(raw.split(',').map((id) => id.trim()))].filter(Boolean);
  if (ids.length === 0 || ids.length > AREA_DETAILS_MAX_IDS || !ids.every(isUuid)) return null;
  return ids;
}

/** GET /api/admin/areas/details?ids= → GET /areas/:id de cada uno (polígonos para el mapa). */
export async function handleAreaDetails(
  request: NextRequest,
  deps: CatalogRouteDeps,
): Promise<NextResponse> {
  if (isCrossSite(request)) return crossSiteResponse();
  const ids = parseIds(request.nextUrl.searchParams.get('ids'));
  if (!ids) {
    return errorJson(
      400,
      ApiErrorCode.VALIDATION_ERROR,
      `Pide entre 1 y ${AREA_DETAILS_MAX_IDS} barrios o veredas por vez.`,
    );
  }
  return respondWithSession(
    request,
    deps.refresh,
    async (token): Promise<AreaDetailsResponse> => {
      const results = await Promise.all(
        ids.map((id) =>
          deps.catalog.area(token, id).catch((failure: unknown) => {
            if (isApiError(failure) && failure.code === ApiErrorCode.NOT_FOUND) return null;
            throw failure;
          }),
        ),
      );
      return {
        items: results.filter((area): area is Area => area !== null),
        missing: ids.filter((_, i) => results[i] === null),
      };
    },
    ok,
  );
}

/** POST /api/admin/areas → POST /admin/areas. */
export async function handleCreateArea(
  request: NextRequest,
  deps: CatalogRouteDeps,
): Promise<NextResponse> {
  const body = await readJson(request, AreaCreateBodySchema);
  if (!body.ok) return body.response;
  return respondWithSession(
    request,
    deps.refresh,
    (token) => deps.catalog.createArea(token, body.data),
    ok,
  );
}

/** PATCH /api/admin/areas/:id → PATCH /admin/areas/:id. */
export async function handleUpdateArea(
  request: NextRequest,
  id: string,
  deps: CatalogRouteDeps,
): Promise<NextResponse> {
  const body = await readJson(request, AreaUpdateBodySchema);
  if (!body.ok) return body.response;
  if (!isUuid(id)) return notFound();
  return respondWithSession(
    request,
    deps.refresh,
    (token) => deps.catalog.updateArea(token, id, body.data),
    ok,
  );
}

/** POST /api/admin/areas/import → POST /admin/areas/import (con dryRun o confirmado). */
export async function handleImportAreas(
  request: NextRequest,
  deps: CatalogRouteDeps,
): Promise<NextResponse> {
  const body = await readJson(request, AreaImportBodySchema);
  if (!body.ok) return body.response;
  return respondWithSession(
    request,
    deps.refresh,
    (token) => deps.catalog.importAreas(token, body.data),
    ok,
  );
}

/** GET /api/admin/areas/:id/history?cursor= → GET /admin/areas/:id/history. */
export async function handleAreaHistory(
  request: NextRequest,
  id: string,
  deps: CatalogRouteDeps,
): Promise<NextResponse> {
  if (isCrossSite(request)) return crossSiteResponse();
  if (!isUuid(id)) return notFound();
  const cursor = request.nextUrl.searchParams.get('cursor')?.slice(0, 512) || undefined;
  return respondWithSession(
    request,
    deps.refresh,
    (token) => deps.catalog.areaHistory(token, id, cursor),
    ok,
  );
}
